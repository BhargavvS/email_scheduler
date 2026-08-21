  import { OAuth2Client } from 'google-auth-library';

  import { env } from './env.js';

  export const googleOAuthClient = new OAuth2Client(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    `${env.API_ORIGIN}/auth/google/callback`,
  );

  export function getGoogleAuthUrl(state: string): string {
    return googleOAuthClient.generateAuthUrl({
      access_type: 'online',
      scope: ['openid', 'email', 'profile'],
      state,
      prompt: 'select_account',
    });
  }