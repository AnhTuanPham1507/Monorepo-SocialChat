import { Injectable } from '@nestjs/common';

import { UserReadMongoRepository } from '@social-chat/infrastructure';

import {
    IUserReadRepository,
    UserReadModel,
} from '../../application/contracts/user-read-repository.contract';

@Injectable()
export class UserReadRepo implements IUserReadRepository {
    constructor(
        private readonly _userReadMongoRepo: UserReadMongoRepository,
    ) {}

    async findById(id: string): Promise<UserReadModel | null> {
        return this._userReadMongoRepo.findById(id) as Promise<UserReadModel | null>;
    }

    async findManyByIds(ids: string[]): Promise<UserReadModel[]> {
        if (ids.length === 0) return [];
        return this._userReadMongoRepo.findMany({ _id: { $in: ids } }) as Promise<UserReadModel[]>;
    }
}
