export interface LoginCredentials {
  email: string;
  password: string;
}
export interface LoginResponse {
  access_token: string;
  token_type: 'bearer';
}
