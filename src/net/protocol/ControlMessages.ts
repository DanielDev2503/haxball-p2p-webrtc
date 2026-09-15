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
  | 'MATCH_STATE_SYNC'
  | 'toggle_pause'
  | 'peer_handshake'
  | 'team_sync'
  | 'kicked'
  | 'banned'
  | 'client_hello'
  | 'initial_state'
  | 'match_control'
  | 'ROOM_SETTINGS_REQUEST'
  | 'ROOM_SETTINGS_SYNC';

export interface RoomConfig {
  name: string;
  maxPlayers: number; // 2 a 16
  isPrivate: boolean;
  password?: string | undefined;
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

export interface MatchStatePayload {
  state: MatchState;
  timeRemaining: number;
  redScore: number;
  blueScore: number;
  countdown: number; // 3, 2, 1 o 0
  banner?: {
    text: string;
    subtext?: string | undefined;
    color: string;
    duration: number;
  } | undefined;
}

export interface MatchStateSyncMessage {
  type: 'MATCH_STATE_SYNC';
  payload: MatchStatePayload;
}

export interface TogglePauseMessage {
  type: 'toggle_pause';
}

export interface ClientHelloMessage {
  type: 'client_hello';
  nickname: string;
  avatar?: string | undefined;
}

export interface InitialStateMessage {
  type: 'initial_state';
  yourPlayerId: string;
  players: Array<{
    id: string;
    name: string;
    avatar: string;
    team: 'red' | 'blue' | 'spec';
    isHost: boolean;
    isAdmin: boolean;
  }>;
  config: RoomConfig;
  matchState: MatchStatePayload;
}

export interface MatchControlMessage {
  type: 'match_control';
  action: 'START' | 'STOP';
}

export interface RoomSettingsRequestMessage {
  type: 'ROOM_SETTINGS_REQUEST';
  timeLimit?: number;
  goalLimit?: number;
  scoreLimit?: number;
  teamsLocked?: boolean;
}

export interface RoomSettingsSyncMessage {
  type: 'ROOM_SETTINGS_SYNC';
  timeLimit: number;
  goalLimit: number;
  scoreLimit?: number;
  teamsLocked: boolean;
}

