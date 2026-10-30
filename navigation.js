/* Small browser-history router for the three app screens and the builder detail step. */
'use strict';

window.TBVNRouter = (() => {
  const parse = () => {
    let hash;
    try { hash = decodeURIComponent(location.hash.slice(1)); }
    catch { hash = ''; }
    const parts = hash.split('/');
    if (parts[0] === 'catalog') return { view: 'catalog' };
    if (parts[0] === 'builder') {
      return { view: 'builder', step: parts[1] === 'indications' ? 'indications' : 'techs', techId: parts[2] || '' };
    }
    return { view: 'dashboard' };
  };
  const url = route => route.view === 'builder'
    ? `#builder/${route.step === 'indications' ? `indications/${encodeURIComponent(route.techId || '')}` : 'techs'}`
    : `#${route.view === 'catalog' ? 'catalog' : 'dashboard'}`;
  const entry = (route, index, previous = '') => ({ tbvn: true, index, route: url(route), previous });

  function start(onChange) {
    const route = parse();
    if (!history.state?.tbvn) history.replaceState(entry(route, 0), '', url(route));
    window.addEventListener('popstate', () => onChange(parse()));
    return route;
  }
  function push(route) {
    const next = url(route);
    if (location.hash === next) return;
    const current = history.state;
    history.pushState(entry(route, (current?.tbvn ? current.index : 0) + 1, location.hash), '', next);
  }
  function replace(route) {
    const current = history.state;
    history.replaceState(entry(route, current?.tbvn ? current.index : 0, current?.previous || ''), '', url(route));
  }
  function backToTechs() {
    if (history.state?.previous === '#builder/techs') history.back();
    else push({ view: 'builder', step: 'techs' });
  }
  function skipInvalidBuilder() {
    if ((history.state?.index || 0) > 0) history.back();
    else replace({ view: 'dashboard' });
  }
  return { start, push, replace, backToTechs, skipInvalidBuilder };
})();
