/* Supabase is the source of truth. No case data is stored in browser storage. */
'use strict';

window.TBVNSync = (() => {
  const config = window.TBVN_CONFIG || {};
  const configured = /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(config.url || '')
    && /^(sb_publishable_|eyJ)/.test(config.publishableKey || '');
  const client = configured && window.supabase
    ? window.supabase.createClient(config.url.replace(/\/$/, ''), config.publishableKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
      })
    : null;
  let clockOffset = 0;
  let channel = null;
  const fail = result => {
    if (result.error) throw result.error;
    return result.data;
  };
  const now = () => Date.now() + clockOffset;

  async function clock() {
    const before = Date.now();
    const serverTime = fail(await client.rpc('tbvn_server_time'));
    clockOffset = Date.parse(serverTime) - (before + Date.now()) / 2;
  }
  async function list() {
    const rows = fail(await client.from('tbvn_cases').select('*')
      .gt('expires_at', new Date(now()).toISOString()).order('created_at', { ascending: true }));
    return rows || [];
  }
  async function insert(row) {
    const result = await client.from('tbvn_cases').insert(row).select().single();
    if (result.error?.code === '23505') {
      const existing = fail(await client.from('tbvn_cases').select('*').eq('id', row.id).maybeSingle());
      if (existing) return existing;
    }
    return fail(result);
  }
  async function change(c, action, data = {}) {
    return fail(await client.rpc('tbvn_change_case', {
      p_id: c.id, p_version: c.version, p_action: action, p_data: data
    }));
  }
  async function remove(c) {
    const result = fail(await client.from('tbvn_cases').delete()
      .eq('id', c.id).eq('version', c.version).select('id').maybeSingle());
    if (!result) throw new Error('TBVN_CONFLICT_OR_EXPIRED');
    return result;
  }
  function subscribe(onChange, onStatus) {
    if (channel) client.removeChannel(channel);
    channel = client.channel('tbvn-cases')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tbvn_cases' }, onChange)
      .subscribe(onStatus);
  }
  function unsubscribe() {
    if (channel) client.removeChannel(channel);
    channel = null;
  }
  return {
    configured: !!client,
    now, clock, list, insert, change, remove, subscribe, unsubscribe
  };
})();
