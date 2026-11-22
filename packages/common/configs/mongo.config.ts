import { IMongoConfig } from './interfaces/mongo-config.interface';

export const getMongoConfig = (): IMongoConfig => {
    if (!process.env.MONGO_URI) {
        throw new Error('MONGO_URI is required');
    }

    return { uri: process.env.MONGO_URI };
};
