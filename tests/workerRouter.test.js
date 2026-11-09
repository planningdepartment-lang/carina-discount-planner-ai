const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

// Cookie parsing helper from src/auth/adminAuth.ts
function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const parts = pair.split('=');
    if (parts.length >= 2) {
      const key = parts[0].trim();
      const value = parts.slice(1).join('=').trim();
      if (key) cookies[key] = value;
    }
  }
  return cookies;
}

// Simulated Router Gatekeeper matching src/index.ts
async function simulateRouterFetch(request, env, mockSessionValidator) {
  const url = new URL(request.url);
  const { pathname } = url;

  const origin = request.headers.get('Origin') || '';
  const corsHeaders = {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true'
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // 0. Public Authentication Endpoints
  if (pathname === '/api/auth/login' && request.method === 'POST') {
    return new Response(JSON.stringify({ endpoint: 'login' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
  if (pathname === '/api/auth/logout' && request.method === 'POST') {
    return new Response(JSON.stringify({ endpoint: 'logout' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
  if (pathname === '/api/auth/me' && request.method === 'GET') {
    return new Response(JSON.stringify({ endpoint: 'me' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // Check Admin Session Authentication
  const cookies = parseCookies(request.headers.get('Cookie'));
  const authHeader = request.headers.get('Authorization') || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const sessionId = cookies['carina_admin_session'] || bearerToken;

  let isAuthenticated = false;
  if (sessionId && mockSessionValidator) {
    const sessionCheck = await mockSessionValidator(sessionId);
    isAuthenticated = sessionCheck.isValid;
  }

  // Gatekeeper: Block unauthenticated requests to protected /api/* endpoints
  if (pathname.startsWith('/api/')) {
    if (!isAuthenticated) {
      return new Response(JSON.stringify({ 
        error: 'Unauthorized: Admin authentication required', 
        authenticated: false 
      }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Authenticated API dispatch mock
    return new Response(JSON.stringify({ success: true, authorizedPath: pathname }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // Static Assets & UI Gatekeeper
  if (env.ASSETS) {
    if (!isAuthenticated && (pathname === '/' || pathname === '/index.html')) {
      return Response.redirect(new URL('/login.html', request.url).toString(), 302);
    }

    if (isAuthenticated && pathname === '/login.html') {
      return Response.redirect(new URL('/', request.url).toString(), 302);
    }

    return new Response('<html>Mock Asset</html>', {
      status: 200,
      headers: {
        'Content-Type': 'text/html',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    });
  }

  return new Response('CARINA Discount Planner API running on Cloudflare Workers.', {
    headers: { 'Content-Type': 'text/plain' }
  });
}

describe('Worker HTTP Router & Auth Gatekeeper (src/index.ts)', () => {
  const activeSessions = new Set(['valid-session-token-123']);
  const mockValidator = async (token) => ({
    isValid: activeSessions.has(token),
    admin: activeSessions.has(token) ? { email: 'admin@carinawear.com' } : null
  });

  const envWithAssets = { ASSETS: {} };

  test('OPTIONS preflight returns CORS headers', async () => {
    const req = new Request('https://carina.internal/api/styles', {
      method: 'OPTIONS',
      headers: { Origin: 'https://dashboard.carinawear.com' }
    });

    const res = await simulateRouterFetch(req, envWithAssets, mockValidator);
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://dashboard.carinawear.com');
    assert.ok(res.headers.get('Access-Control-Allow-Methods').includes('GET'));
  });

  test('Unauthenticated API calls to protected /api/styles return 401', async () => {
    const req = new Request('https://carina.internal/api/styles', {
      method: 'GET'
    });

    const res = await simulateRouterFetch(req, envWithAssets, mockValidator);
    assert.equal(res.status, 401);

    const body = await res.json();
    assert.equal(body.authenticated, false);
    assert.ok(body.error.includes('Unauthorized'));
  });

  test('Public auth endpoints (/api/auth/login) are accessible without auth', async () => {
    const req = new Request('https://carina.internal/api/auth/login', {
      method: 'POST'
    });

    const res = await simulateRouterFetch(req, envWithAssets, mockValidator);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.endpoint, 'login');
  });

  test('Valid cookie carina_admin_session unlocks protected API endpoints', async () => {
    const req = new Request('https://carina.internal/api/styles', {
      method: 'GET',
      headers: {
        'Cookie': 'carina_admin_session=valid-session-token-123; user_pref=light'
      }
    });

    const res = await simulateRouterFetch(req, envWithAssets, mockValidator);
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.authorizedPath, '/api/styles');
  });

  test('Valid Bearer Authorization header unlocks protected API endpoints', async () => {
    const req = new Request('https://carina.internal/api/simulate', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer valid-session-token-123'
      }
    });

    const res = await simulateRouterFetch(req, envWithAssets, mockValidator);
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.equal(body.authorizedPath, '/api/simulate');
  });

  test('Unauthenticated root visit (/) redirects to /login.html with 302', async () => {
    const req = new Request('https://carina.internal/', {
      method: 'GET'
    });

    const res = await simulateRouterFetch(req, envWithAssets, mockValidator);
    assert.equal(res.status, 302);
    assert.ok(res.headers.get('Location').includes('/login.html'));
  });

  test('Authenticated /login.html visit redirects to / with 302', async () => {
    const req = new Request('https://carina.internal/login.html', {
      method: 'GET',
      headers: {
        'Cookie': 'carina_admin_session=valid-session-token-123'
      }
    });

    const res = await simulateRouterFetch(req, envWithAssets, mockValidator);
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('Location'), 'https://carina.internal/');
  });

  test('Static asset responses enforce no-cache headers', async () => {
    const req = new Request('https://carina.internal/styles.css', {
      method: 'GET',
      headers: {
        'Cookie': 'carina_admin_session=valid-session-token-123'
      }
    });

    const res = await simulateRouterFetch(req, envWithAssets, mockValidator);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Cache-Control'), 'no-cache, no-store, must-revalidate');
  });
});
