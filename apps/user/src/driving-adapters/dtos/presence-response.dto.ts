import { ApiProperty } from '@nestjs/swagger';

export class UserPresenceResponseDto {
    @ApiProperty()
    userId: string;

    @ApiProperty()
    status: boolean;

    @ApiProperty({ nullable: true, description: 'Epoch ms of last offline transition; null if never seen' })
    lastOnlineAt: number | null;
}
