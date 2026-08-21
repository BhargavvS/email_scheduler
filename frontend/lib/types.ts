export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  provider: 'google' | 'password';
}

export interface AuthResponse {
  user: User;
  token: string;
}

export interface ApiErrorBody {
  error?: { code?: string; message?: string };
}
