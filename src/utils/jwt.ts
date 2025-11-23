type JwtPayload = {
  sub?: string;   // user id
  email?: string;
  exp?: number;
  [key: string]: any;
};

export function parseJwt(token: string): JwtPayload | null {
  try {
    const base64Url = token.split('.')[1]; 
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(json);
  } catch (e) {
    console.error('Invalid JWT', e);
    return null;
  }
}