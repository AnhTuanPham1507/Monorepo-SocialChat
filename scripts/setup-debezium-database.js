const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const rootDir = path.resolve(__dirname, '..');
const connectorTemplatePath = path.join(
    rootDir,
    'scripts',
    'connectors',
    'social-chat-postgres-connector.json',
);
const heartbeatTable = 'test.debezium_heartbeat';

function quoteIdentifier(identifier) {
    return `"${identifier.replaceAll('"', '""')}"`;
}

function quoteRelation(relation) {
    const parts = relation.split('.');

    if (parts.length !== 2 || parts.some((part) => part.length === 0)) {
        throw new Error(`Invalid schema-qualified table name: ${relation}`);
    }

    return parts.map(quoteIdentifier).join('.');
}

function getSslConfig() {
    const sslMode = (process.env.DEBEZIUM_DB_SSLMODE || 'verify-full').toLowerCase();

    if (sslMode === 'disable') {
        return false;
    }

    if (sslMode === 'require') {
        return { rejectUnauthorized: false };
    }

    if (!['verify-ca', 'verify-full'].includes(sslMode)) {
        throw new Error(`Unsupported DEBEZIUM_DB_SSLMODE: ${sslMode}`);
    }

    const configuredCaPath = process.env.DB_SSL_CA_PATH;

    if (!configuredCaPath) {
        throw new Error(
            'DB_SSL_CA_PATH is required when DEBEZIUM_DB_SSLMODE verifies the server certificate.',
        );
    }

    const caPath = path.resolve(rootDir, configuredCaPath);

    if (!fs.existsSync(caPath)) {
        throw new Error(`PostgreSQL CA certificate not found at ${caPath}`);
    }

    return {
        rejectUnauthorized: true,
        ca: fs.readFileSync(caPath, 'utf8'),
    };
}

async function main() {
    const connectorTemplate = JSON.parse(
        fs.readFileSync(connectorTemplatePath, 'utf8'),
    );
    const connectorConfig = connectorTemplate.config;
    const publicationName = connectorConfig['publication.name'];
    const slotName = connectorConfig['slot.name'];
    const includedTables = connectorConfig['table.include.list']
        .split(',')
        .map((table) => table.trim())
        .filter(Boolean);

    if (!publicationName || !slotName || includedTables.length === 0) {
        throw new Error(
            'Connector template must define publication.name, slot.name, and table.include.list.',
        );
    }

    const client = new Client({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT),
        user: process.env.DB_USERNAME,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_DATABASE,
        ssl: getSslConfig(),
        connectionTimeoutMillis: 10_000,
        application_name: 'social-chat-debezium-setup',
    });

    await client.connect();

    try {
        const walLevelResult = await client.query('SHOW wal_level');
        const walLevel = walLevelResult.rows[0].wal_level;

        if (walLevel !== 'logical') {
            throw new Error(
                `PostgreSQL wal_level is "${walLevel}"; Debezium requires "logical".`,
            );
        }

        await client.query(
            `CREATE TABLE IF NOT EXISTS ${quoteRelation(heartbeatTable)} (
                id integer PRIMARY KEY,
                updated_at timestamptz NOT NULL
            )`,
        );

        const publicationTables = [...includedTables, heartbeatTable];

        for (const table of publicationTables) {
            const relationResult = await client.query(
                'SELECT to_regclass($1) AS relation',
                [table],
            );

            if (!relationResult.rows[0].relation) {
                throw new Error(
                    `Debezium table ${table} does not exist after migrations.`,
                );
            }
        }

        const capabilityResult = await client.query(
            `SELECT
                current_user AS username,
                role.rolreplication AS can_replicate,
                EXISTS (
                    SELECT 1
                    FROM pg_replication_slots
                    WHERE slot_name = $1
                ) AS slot_exists
             FROM pg_roles AS role
             WHERE role.rolname = current_user`,
            [slotName],
        );
        const capability = capabilityResult.rows[0];

        if (!capability.can_replicate && !capability.slot_exists) {
            throw new Error(
                `Database user ${capability.username} needs REPLICATION privilege so Debezium can create slot ${slotName}.`,
            );
        }

        const publicationResult = await client.query(
            'SELECT puballtables FROM pg_publication WHERE pubname = $1',
            [publicationName],
        );

        if (publicationResult.rowCount === 0) {
            const tableList = publicationTables.map(quoteRelation).join(', ');

            await client.query(
                `CREATE PUBLICATION ${quoteIdentifier(publicationName)} FOR TABLE ${tableList}`,
            );
            console.log(
                `Created publication ${publicationName} for ${publicationTables.join(', ')}.`,
            );
        } else if (!publicationResult.rows[0].puballtables) {
            const publishedTablesResult = await client.query(
                `SELECT schemaname || '.' || tablename AS table_name
                 FROM pg_publication_tables
                 WHERE pubname = $1`,
                [publicationName],
            );
            const publishedTables = new Set(
                publishedTablesResult.rows.map((row) => row.table_name),
            );
            const missingTables = publicationTables.filter(
                (table) => !publishedTables.has(table),
            );

            if (missingTables.length > 0) {
                await client.query(
                    `ALTER PUBLICATION ${quoteIdentifier(publicationName)} ADD TABLE ${missingTables
                        .map(quoteRelation)
                        .join(', ')}`,
                );
                console.log(
                    `Added ${missingTables.join(', ')} to publication ${publicationName}.`,
                );
            } else {
                console.log(
                    `Publication ${publicationName} already contains all configured tables.`,
                );
            }
        } else {
            console.log(
                `Publication ${publicationName} already covers all database tables.`,
            );
        }

        console.log(
            `PostgreSQL is ready for Debezium slot ${slotName} using wal_level=${walLevel}.`,
        );
    } finally {
        await client.end();
    }
}

main().catch((error) => {
    console.error(`Debezium database setup failed: ${error.message}`);
    process.exitCode = 1;
});
