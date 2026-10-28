import { Env } from '../config/env';
import { 
  verifyPassword, 
  createAdminSession, 
  validateAdminSession, 
  revokeAdminSession, 
  parseCookies, 
  createSessionCookie, 
  createClearCookie,
  COOKIE_NAME
} from '../auth/adminAuth';

export async function handleLogin(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const body = (await request.json()) as { email?: string; password?: string };
    const email = (body.email || '').trim().toLowerCase();
    const password = body.password || '';

    if (!email || !password) {
      return new Response(JSON.stringify({ success: false, error: 'Email and password are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const { results } = await env.DB.prepare(`
      SELECT id, email, password_hash, salt, display_name, is_active
      FROM admin_users
      WHERE LOWER(email) = ? AND is_active = 1
    `).bind(email).all<any>();

    if (!results || results.length === 0) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid email or password' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const admin = results[0];
    const isPasswordValid = await verifyPassword(password, admin.salt, admin.password_hash);
    if (!isPasswordValid) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid email or password' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const ipAddress = request.headers.get('cf-connecting-ip') || 'unknown';
    const userAgent = request.headers.get('user-agent') || 'unknown';

    const sessionId = await createAdminSession(env.DB, admin.id, ipAddress, userAgent);
    const cookieHeader = createSessionCookie(sessionId);

    return new Response(JSON.stringify({
      success: true,
      admin: {
        id: admin.id,
        email: admin.email,
        displayName: admin.display_name
      }
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Set-Cookie': cookieHeader
      }
    });
  } catch (err: any) {
    console.error('Login error:', err);
    return new Response(JSON.stringify({ success: false, error: err.message || 'Internal Server Error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

export async function handleLogout(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const cookies = parseCookies(request.headers.get('Cookie'));
    const sessionId = cookies[COOKIE_NAME];
    if (sessionId) {
      await revokeAdminSession(env.DB, sessionId);
    }

    return new Response(JSON.stringify({ success: true, message: 'Logged out successfully' }), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Set-Cookie': createClearCookie()
      }
    });
  } catch (err: any) {
    console.error('Logout error:', err);
    return new Response(JSON.stringify({ success: false, error: err.message || 'Internal Server Error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

export async function handleMe(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const cookies = parseCookies(request.headers.get('Cookie'));
  const sessionId = cookies[COOKIE_NAME];

  if (!sessionId) {
    return new Response(JSON.stringify({ authenticated: false }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const { isValid, admin } = await validateAdminSession(env.DB, sessionId);
  if (!isValid || !admin) {
    return new Response(JSON.stringify({ authenticated: false }), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Set-Cookie': createClearCookie()
      }
    });
  }

  return new Response(JSON.stringify({
    authenticated: true,
    admin
  }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}
