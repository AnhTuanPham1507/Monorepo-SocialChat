import { ApiProperty } from '@nestjs/swagger';

export class FriendSuggestionItemResponseDto {
    @ApiProperty({ description: 'Suggested user ID' })
    userId: string;

    @ApiProperty({ description: 'Suggested user display name' })
    displayName: string;

    @ApiProperty({ description: 'Suggested user avatar URL', nullable: true })
    avatarUrl: string | null;

    @ApiProperty({ description: 'Number of mutual friends' })
    mutualFriendsCount: number;

    @ApiProperty()
    isSentFriendRequest: boolean;

    @ApiProperty({
        description: 'Direction of the pending friend request, or null when no request is pending',
        enum: ['sent', 'received'],
        nullable: true,
    })
    friendRequestDirection: 'sent' | 'received' | null;
}
