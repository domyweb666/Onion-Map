updateStats();
Promise.all([restored, mapReady]).then(() => hook.ready.forEach(fn => { try { fn(); } catch (e) { console.error(e); } }));
