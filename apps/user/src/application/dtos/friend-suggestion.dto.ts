import { FriendRequestDirection } from './friend-request.dto';

export interface FriendSuggestionItem {
    userId: string;
    displayName: string;
    avatarUrl: string | null;
    mutualFriendsCount: number;
    isSentFriendRequest: boolean;
    friendRequestDirection: FriendRequestDirection | null;
}
