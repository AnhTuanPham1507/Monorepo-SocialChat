import { Admin, KafkaJSProtocolError } from 'kafkajs';

const TOPIC_METADATA_RETRY_DELAY_MS = 100;
const TOPIC_METADATA_MAX_ATTEMPTS = 300;

const TRANSIENT_TOPIC_METADATA_ERRORS = new Set([
    'UNKNOWN_TOPIC_OR_PARTITION',
    'LEADER_NOT_AVAILABLE',
    'NOT_LEADER_FOR_PARTITION',
]);

const delay = (milliseconds: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, milliseconds));



/**
 * Creates topics and waits until Kafka metadata reports a leader for every
 * partition.
 *
 * KafkaJS 2.2.x only retries LEADER_NOT_AVAILABLE in createTopics' built-in
 * leader wait. Kafka in KRaft mode can instead return
 * UNKNOWN_TOPIC_OR_PARTITION while the new metadata is propagating, so topic
 * creation must not use that built-in wait.
 */
export async function ensureKafkaTopicsReady(admin: Admin, topics: string[]): Promise<void> {
    if (topics.length === 0) {
        return;
    }


    await admin.createTopics({
        topics: topics.map((topic) => ({
            topic,
        })),
        waitForLeaders: false,
    }).catch(
        (err) => {
            console.log(111, err)
            throw err;
        }
    );

    let lastTransientError: KafkaJSProtocolError | undefined;

    for (let attempt = 1; attempt <= TOPIC_METADATA_MAX_ATTEMPTS; attempt += 1) {
        try {
            const metadata = await admin.fetchTopicMetadata({ topics });
            const readyTopics = new Set(
                metadata.topics
                    .filter(
                        (topic) =>
                            topic.partitions.length > 0 &&
                            topic.partitions.every((partition) => partition.leader >= 0),
                    )
                    .map((topic) => topic.name),
            );

            if (topics.every((topic) => readyTopics.has(topic))) {
                return;
            }
        } catch (error) {
            if (
                !(error instanceof KafkaJSProtocolError) ||
                !TRANSIENT_TOPIC_METADATA_ERRORS.has(error.type)
            ) {
                throw error;
            }

            lastTransientError = error;
        }

        if (attempt < TOPIC_METADATA_MAX_ATTEMPTS) {
            await delay(TOPIC_METADATA_RETRY_DELAY_MS);
        }
    }

    throw new Error(`Timed out waiting for Kafka topic leaders: ${topics.join(', ')}`, {
        cause: lastTransientError,
    });
}
