import { Logger, OnModuleInit } from '@nestjs/common';
import { API, Client, Types } from '@opensearch-project/opensearch';

type QueryContainer = Types.Common_QueryDsl.QueryContainer;

export interface SearchResult<TDocument> {
    items: TDocument[];
    total: number;
}

/**
 * OpenSearch 3.6 generates an incomplete element type for `hits.hits`.
 * This describes the response fields consumed by our search adapters.
 */
export interface OpenSearchHit<TDocument> {
    _id?: string;
    _score?: number;
    _source?: TDocument;
    highlight?: Record<string, string[]>;
    sort?: Types.Common.SortResults;
}

export interface IndexConfig {
    index: string;
    alias: string;
    settings: Types.Indices_Common.IndexSettings;
    mappings: Types.Common_Mapping.TypeMapping;
}

export abstract class BaseOpenSearchService<
    TDocument extends Record<string, any>,
> implements OnModuleInit {
    protected readonly logger: Logger;

    constructor(
        protected readonly openSearchClient: Client,
        protected readonly indexConfig: IndexConfig,
    ) {
        this.logger = new Logger(this.constructor.name);
    }

    // =========================================================================
    // INDEX LIFECYCLE (runs on module init)
    // =========================================================================

    async onModuleInit(): Promise<void> {
        await this.ensureIndex();
    }

    private async ensureIndex(): Promise<void> {
        const { alias, index, settings, mappings } = this.indexConfig;

        const aliasExists = await this.openSearchClient.indices.existsAlias({
            name: alias,
        });

        if (aliasExists.body) {
            this.logger.log(`Alias "${alias}" already exists, skipping index creation`);
            return;
        }

        const indexExists = await this.openSearchClient.indices.exists({
            index,
        });

        if (!indexExists.body) {
            await this.openSearchClient.indices.create({
                index,
                body: { settings, mappings },
            });
            this.logger.log(`Created index "${index}"`);
        }

        await this.openSearchClient.indices.putAlias({
            index,
            name: alias,
        });
        this.logger.log(`Created alias "${alias}" → "${index}"`);
    }

    async recreateIndex(loader: (alias: string) => Promise<void>): Promise<void> {
        const { alias, settings, mappings } = this.indexConfig;

        const oldIndex = await this.getCurrentAliasTarget();
        const newIndex = `${alias}_${Date.now()}`;

        await this.openSearchClient.indices.create({
            index: newIndex,
            body: { settings, mappings },
        });
        this.logger.log(`Created index "${newIndex}"`);

        const swapActions: Types.Indices_UpdateAliases.Action[] = [
            { add: { index: newIndex, alias } },
        ];
        if (oldIndex) {
            swapActions.unshift({ remove: { index: oldIndex, alias } });
        }
        await this.openSearchClient.indices.updateAliases({
            body: { actions: swapActions },
        });
        this.logger.log(
            oldIndex
                ? `Swapped alias "${alias}": "${oldIndex}" → "${newIndex}"`
                : `Attached alias "${alias}" → "${newIndex}"`,
        );

        await loader(alias);

        if (oldIndex) {
            await this.openSearchClient.indices.delete({ index: oldIndex });
            this.logger.log(`Deleted old index "${oldIndex}"`);
        }
    }

    private async getCurrentAliasTarget(): Promise<string | null> {
        try {
            const response = await this.openSearchClient.indices.getAlias({
                name: this.indexConfig.alias,
            });
            const indices = Object.keys(response.body);
            if (indices.length === 0) return null;
            if (indices.length > 1) {
                this.logger.warn(
                    `Alias "${this.indexConfig.alias}" points to multiple indices: ${indices.join(', ')}. Using "${indices[0]}".`,
                );
            }
            return indices[0];
        } catch (error: any) {
            if (this.getStatusCode(error) === 404) return null;
            throw error;
        }
    }

    // =========================================================================
    // DOCUMENT OPERATIONS
    // =========================================================================

    async indexDocument(id: string, document: TDocument, version?: number): Promise<void> {
        try {
            await this.openSearchClient.index({
                index: this.indexConfig.alias,
                id,
                body: document,
                ...(version !== undefined ? { version, version_type: 'external' } : {}),
            });
        } catch (error: any) {
            if (this.getStatusCode(error) === 409) {
                this.logger.log(
                    `Skipped stale write for "${id}" (incoming version=${version} <= stored)`,
                );
                return;
            }
            throw error;
        }
    }

    async bulkIndex(
        documents: TDocument[],
        idField: keyof TDocument = 'id' as keyof TDocument,
        getVersion?: (doc: TDocument) => number,
    ): Promise<void> {
        if (documents.length === 0) return;

        const operations = documents.flatMap((doc) => {
            const meta: Types.Core_Bulk.OperationContainer = {
                index: {
                    _index: this.indexConfig.alias,
                    _id: String(doc[idField]),
                    ...(getVersion ? { version: getVersion(doc), version_type: 'external' } : {}),
                },
            };
            return [meta, doc];
        });

        const response = await this.openSearchClient.bulk({
            body: operations,
            refresh: true,
        });
        const result = response.body;

        if (!result.errors) return;

        const stale: typeof result.items = [];
        const failed: typeof result.items = [];
        for (const item of result.items) {
            const status = item.index?.status;
            if (status === 409) {
                stale.push(item);
            } else if (item.index?.error) {
                failed.push(item);
            }
        }

        if (stale.length > 0) {
            this.logger.log(
                `Skipped ${stale.length}/${documents.length} stale bulk writes (409, expected under version_type=external)`,
            );
        }
        if (failed.length > 0) {
            this.logger.error(
                `Bulk index errors: ${failed.length}/${documents.length} failed`,
                JSON.stringify(failed.map((item) => item.index?.error)),
            );
        }
    }

    async deleteDocument(id: string, version?: number): Promise<void> {
        try {
            await this.openSearchClient.delete({
                index: this.indexConfig.alias,
                id,
                ...(version !== undefined ? { version, version_type: 'external' } : {}),
            });
        } catch (error: any) {
            if (this.getStatusCode(error) === 404) {
                this.logger.warn(`Document "${id}" not found for deletion`);
                return;
            }
            if (this.getStatusCode(error) === 409) {
                this.logger.log(
                    `Skipped stale delete for "${id}" (incoming version=${version} <= stored)`,
                );
                return;
            }
            throw error;
        }
    }

    // =========================================================================
    // SEARCH (protected — subclasses build queries and call this)
    // =========================================================================

    protected async executeSearch(
        query: QueryContainer,
        options?: {
            from?: number;
            size?: number;
            sort?: API.Search_RequestBody['sort'];
            searchAfter?: (string | number)[];
            highlight?: API.Search_RequestBody['highlight'];
        },
    ): Promise<SearchResult<TDocument>> {
        const response = await this.openSearchClient.search({
            index: this.indexConfig.alias,
            body: {
                query,
                from: options?.searchAfter ? undefined : options?.from,
                size: options?.size ?? 20,
                sort: options?.sort,
                search_after: options?.searchAfter,
                highlight: options?.highlight,
            },
        });
        const result = response.body;

        const total =
            typeof result.hits.total === 'number'
                ? result.hits.total
                : (result.hits.total?.value ?? 0);

        const hits = result.hits.hits as unknown as OpenSearchHit<TDocument>[];
        const items = hits.map((hit) => ({
            ...(hit._source as TDocument),
            ...(hit.highlight ? { _highlight: hit.highlight } : {}),
        }));

        return { items, total };
    }

    private getStatusCode(error: any): number | undefined {
        return error?.statusCode ?? error?.meta?.statusCode;
    }
}
