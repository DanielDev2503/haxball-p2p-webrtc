import { MatchConfig } from '../../core/game/GameState';
import { MatchState } from '../../core/game/GameFSM';

export type ControlMessageType =
  | 'kick_player'
  | 'ban_player'
  | 'set_admin'
  | 'lock_teams'
  | 'update_room_config'
  | 'change_team'
  | 'sync_players'
  | 'set_game_state'
  | 'peer_handshake'
  | 'team_sync'
  | 'kicked'
  | 'banned';

export interface RoomConfig {
  name: string;
  maxPlayers: number; // 2 a 16
  isPrivate: boolean;
  password?: string;
  timeLimit: number; // En minutos; 0 = Indefinido
  scoreLimit: number; // Goles; 0 = Indefinido
  teamsLocked: boolean;
}

export interface KickPlayerMessage {
  type: 'kick_player';
  targetId: string;
  reason?: string;
}

export interface BanPlayerMessage {
  type: 'ban_player';
  targetId: string;
  reason?: string;
}

export interface SetAdminMessage {
  type: 'set_admin';
  targetId: string;
  isAdmin: boolean;
}

export interface LockTeamsMessage {
  type: 'lock_teams';
  locked: boolean;
}

export interface UpdateRoomConfigMessage {
  type: 'update_room_config';
  config: Partial<RoomConfig>;
}

export interface ChangeTeamMessage {
  type: 'change_team';
  playerId: string;
  team: 'red' | 'blue' | 'spec';
}

export interface SetGameStateMessage {
  type: 'set_game_state';
  state: MatchState;
}

export interface PeerHandshakeMessage {
  type: 'peer_handshake';
  playerId: string;
  name: string;
  avatar?: string;
}

export interface TeamSyncMessage {
  type: 'team_sync';
  players: any[];
}

