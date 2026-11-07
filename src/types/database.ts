export type ConnectionStatus = 'pending' | 'accepted' | 'denied' | 'revoked';

export interface Profile {
  id: string;
  display_name: string;
  created_at: string;
}

export interface Connection {
  id: string;
  requester_id: string;
  target_id: string;
  status: ConnectionStatus;
  created_at: string;
  responded_at: string | null;
}

export interface ConnectionWithNames extends Connection {
  requester_name: string;
  target_name: string;
}

export interface UserLocation {
  user_id: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  updated_at: string;
}

export type CommandType = 'ring' | 'message';

export interface CommandRecord {
  id: string;
  from_user_id: string;
  to_user_id: string;
  type: CommandType;
  payload: string | null;
  created_at: string;
}

export interface MessageRecord {
  id: string;
  connection_id: string;
  sender_id: string;
  recipient_id: string;
  body: string;
  created_at: string;
  read_at: string | null;
}

export interface RequestLocationRpcResult {
  success: boolean;
  code:
  | 'CREATED'
  | 'REQUEST_SENT'
  | 'UNAUTHENTICATED'
  | 'UNVERIFIED_EMAIL'
  | 'RATE_LIMITED'
  | 'INVALID_EMAIL'
  | 'USER_NOT_FOUND'
  | 'SELF_REQUEST'
  | 'ALREADY_PENDING'
  | 'ALREADY_ACCEPTED';
  message: string;
  connection_id?: string | null;
}
