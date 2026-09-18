const MAX_MESSAGE_LENGTH = 2000;
const CONTACT_TO_EMAIL = 'banerjeesoumyadip1991@gmail.com';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/contact') {
      return handleContact(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};

async function handleContact(request, env) {
  if (request.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, 405);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  const { name, email, message, website } = body ?? {};

  if (typeof website === 'string' && website.trim() !== '') {
    return jsonResponse({ ok: false, error: 'Invalid submission' }, 400);
  }

  if (typeof email !== 'string' || !email.trim() || typeof message !== 'string' || !message.trim()) {
    return jsonResponse({ ok: false, error: 'Email and message are required' }, 400);
  }

  const trimmedMessage = message.slice(0, MAX_MESSAGE_LENGTH);
  const senderName = typeof name === 'string' && name.trim() ? name.trim() : 'Someone';

  const resendResponse = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Job Triage <onboarding@resend.dev>',
      to: [CONTACT_TO_EMAIL],
      reply_to: email,
      subject: `Job Triage message from ${senderName}`,
      text: trimmedMessage,
    }),
  });

  if (!resendResponse.ok) {
    return jsonResponse({ ok: false, error: 'Failed to send message' }, 502);
  }

  return jsonResponse({ ok: true }, 200);
}

function jsonResponse(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
