"use strict";
const el = id => document.getElementById(id);
const local = ["localhost", "127.0.0.1"].includes(location.hostname);
const apiBase = local ? `${location.protocol}//${location.hostname}:8000/api/v1` : document.querySelector('meta[name="feely-api-base"]').content;
let token = "", folder = "inbox", current = null, replyId = null, lastId = null;
const notice = text => { el("notice").textContent = text; };
async function api(path, options = {}, binary = false) {
  const response = await fetch(apiBase + path, { ...options, cache: "no-store", headers: {
    "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers
  }});
  if (!response.ok) {
    let data = {}; try { data = await response.json(); } catch {}
    if (response.status === 401 && token) logout();
    throw new Error(typeof data.detail === "string" ? data.detail : `Request failed (${response.status}).`);
  }
  return binary ? response.blob() : response.json();
}
function logout() {
  token = ""; current = null; replyId = null;
  el("workspace").hidden = true; el("login").hidden = false; el("logout").hidden = true;
  el("list").replaceChildren(); el("body").textContent = ""; el("compose").reset();
  el("message").hidden = true; el("compose").hidden = true; el("empty").hidden = false;
}
function safe(action) { return async event => { try { await action(event); } catch(error) { notice(error.message); } }; }
async function refresh(older = false) {
  const status = await api("/webmail/status");
  el("address").textContent = status.address; el("from").textContent = status.address;
  el("sync").textContent = status.error || (status.last_success ? `Last checked: ${new Date(status.last_success).toLocaleString()}` : "Waiting for first incoming mail check.");
  const rows = await api(`/webmail/messages?folder=${folder}${older && lastId ? `&before=${lastId}` : ""}`);
  if (!older) el("list").replaceChildren();
  for (const row of rows) {
    const button = document.createElement("button"); button.className = `mail-row ${row.is_read ? "" : "unread"}`;
    button.textContent = row.subject || "(No subject)";
    const sub = document.createElement("span"); sub.textContent = folder === "inbox" ? row.sender : row.recipient;
    button.append(sub); button.onclick = safe(() => openMessage(row.id)); el("list").append(button);
  }
  if (!older && !rows.length) el("list").textContent = "No messages here yet.";
  lastId = rows.at(-1)?.id; el("older").hidden = rows.length < 50;
}
async function download(path, name) {
  const blob = await api(path, {}, true); const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = name.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_"); a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function openMessage(id) {
  current = await api(`/webmail/messages/${id}`);
  el("compose").hidden = true; el("empty").hidden = true; el("message").hidden = false;
  el("subject").textContent = current.subject; el("sender").textContent = `From: ${current.sender} · To: ${current.recipient}`;
  el("date").textContent = new Date(current.created_at).toLocaleString(); el("body").textContent = current.body;
  el("attachments").replaceChildren();
  for (const attachment of current.attachments) {
    const b = document.createElement("button"); b.textContent = `Download ${attachment.name}`;
    b.onclick = safe(() => download(`/webmail/messages/${id}/attachments/${attachment.index}`, attachment.name)); el("attachments").append(b);
  }
}
function compose(reply = false) {
  el("compose").reset(); replyId = reply ? current.id : null;
  if (reply) {
    el("compose").elements.to.value = current.reply_to;
    el("compose").elements.subject.value = /^re:/i.test(current.subject) ? current.subject : `Re: ${current.subject}`;
  }
  el("message").hidden = true; el("empty").hidden = true; el("compose").hidden = false;
  el("compose").elements[reply ? "body" : "to"].focus();
}
el("login").onsubmit = safe(async event => {
  event.preventDefault(); notice("");
  const f = event.target; const data = await api("/admin/login", {method:"POST",body:JSON.stringify({username:f.elements.username.value,password:f.elements.password.value})});
  token = data.access_token; f.elements.password.value = "";
  await refresh(); el("login").hidden = true; el("workspace").hidden = false; el("logout").hidden = false;
});
el("logout").onclick = logout;
el("refresh").onclick = safe(() => refresh()); el("older").onclick = safe(() => refresh(true));
document.querySelectorAll("[data-folder]").forEach(button => button.onclick = safe(async () => {
  folder = button.dataset.folder; el("folder").textContent = button.textContent;
  document.querySelectorAll("[data-folder]").forEach(b => b.setAttribute("aria-current", String(b === button)));
  await refresh();
}));
el("new").onclick = () => compose(); el("reply").onclick = () => compose(true);
el("cancel").onclick = () => { el("compose").hidden = true; el("empty").hidden = false; };
el("trash").onclick = safe(async () => { await api(`/webmail/messages/${current.id}/trash`, {method:"POST"}); el("message").hidden = true; el("empty").hidden = false; await refresh(); });
el("raw").onclick = safe(() => download(`/webmail/messages/${current.id}/raw`, "message.eml"));
el("compose").onsubmit = safe(async event => {
  event.preventDefault(); el("send").disabled = true; notice("Sending…");
  try {
    const f = event.target;
    const result = await api("/webmail/send", {method:"POST",body:JSON.stringify({to:f.elements.to.value,subject:f.elements.subject.value,body:f.elements.body.value,reply_to_id:replyId})});
    f.reset(); el("compose").hidden = true; el("empty").hidden = false; notice(result.detail); await refresh();
  } finally { el("send").disabled = false; }
});
