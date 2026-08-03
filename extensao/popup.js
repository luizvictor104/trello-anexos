"use strict";

/* AtDownloader — extensão
   ───────────────────────
   Existe porque o Power-Up não conseguia baixar imagem e vídeo, por duas
   barreiras que uma página comum não vence e uma extensão vence:

   1. O Trello só manda "Content-Disposition: attachment" no que o navegador
      não sabe exibir. Para png, jpeg, mp4, mov e mp3 ele manda o arquivo para
      ser EXIBIDO — então apontar uma janela para a URL só mostra o arquivo,
      não salva. Aqui isso não importa: chrome.downloads.download salva o que
      mandarmos, com o nome que mandarmos, ignorando esse cabeçalho.

   2. Uma página hospedada num endereço não pode ler a resposta que vem de
      outro endereço sem autorização, e a resposta do Trello não autoriza.
      A extensão declara "https://trello.com/*" em host_permissions e por isso
      pode ler — é o que permite listar os anexos usando o cookie da sua
      sessão, sem token e sem tela de autorização.

   Bônus: como cada arquivo vai direto para o disco, um a um, os Reels de
   100+ MB deixam de ser um problema. O plano do .zip precisava empilhar tudo
   na memória antes de salvar. */

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

let board = null, grupos = [], itens = [];

const kb = n => {
  if (n == null || !isFinite(n)) return "";
  if (n < 1024) return n + " B";
  if (n < 1048576) return (n / 1024).toFixed(0) + " KB";
  return (n / 1048576).toFixed(1).replace(".", ",") + " MB";
};
const escapar = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function telaCentro(html) { $("#corpo").innerHTML = `<div class="centro">${html}</div>`; }

function ehArquivo(a) {
  if (a && a.isUpload === true) return true;
  if (typeof a.bytes === "number" && a.bytes > 0) return true;
  return /\/attachments\/[a-f0-9]{24}\/download\//i.test(a.url || "");
}

/* O Chrome recusa nome de arquivo com estes caracteres, e o Finder detesta
   nome terminado em ponto ou espaço. Barra vira travessão para não criar
   pasta sem querer: quem decide a hierarquia é o caminho que montamos. */
function nomeSeguro(nome) {
  return String(nome || "arquivo")
    .replace(/[\/\\]/g, "—")
    .replace(/[<>:"|?*\x00-\x1f]/g, "")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .slice(0, 120) || "arquivo";
}

/* ---------- ler o board ---------- */
async function api(caminho) {
  const r = await fetch("https://api.trello.com/1" + caminho, { credentials: "include" });
  if (!r.ok) { const e = new Error("HTTP " + r.status); e.status = r.status; throw e; }
  return r.json();
}

/* Se a aba já está num board, usa ele. Se não, mostra a lista para escolher —
   assim a extensão serve mesmo com o Trello fechado. */
async function carregar() {
  const [aba] = await chrome.tabs.query({ active: true, currentWindow: true });
  const m = (aba && aba.url || "").match(/^https:\/\/trello\.com\/b\/([a-zA-Z0-9]+)/);
  if (!m) return telaEscolherBoard();
  return abrirBoard(m[1]);
}

async function telaEscolherBoard() {
  let boards;
  try {
    boards = await api("/members/me/boards?fields=name,shortLink&filter=open");
  } catch (e) {
    $("#titulo").textContent = "Não consegui falar com o Trello";
    if (e.status === 401) {
      return telaCentro(`<b>O Trello não reconheceu a sessão.</b>
        A extensão usa o login que você já tem no navegador — confira se está
        logado em trello.com nesta mesma janela do Chrome.`);
    }
    return telaCentro(`<b>Algo deu errado.</b> ${escapar(e.message || "")}`);
  }

  boards.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  $("#titulo").textContent = "Escolha um board";
  $("#sub").textContent = `${boards.length} board${boards.length === 1 ? "" : "s"}`;
  $("#rodape").hidden = true;
  $("#corpo").innerHTML = boards.map(b => `
    <label class="item" style="padding-left:2px; cursor:pointer">
      <span class="nome"><b>${escapar(b.name)}</b></span>
      <button class="abrir" data-b="${escapar(b.shortLink)}"
        style="padding:5px 11px; font-size:12px">Abrir</button>
    </label>`).join("");
  $("#corpo").addEventListener("click", e => {
    const btn = e.target.closest("button.abrir");
    if (!btn) return;
    telaCentro("Lendo os anexos do board…");
    $("#sub").textContent = "";
    abrirBoard(btn.dataset.b);
  });
}

async function abrirBoard(shortLink) {
  let cards;
  try {
    board = await api(`/boards/${shortLink}?fields=name`);
    cards = await api(`/boards/${shortLink}/cards?fields=name&attachments=true`);
  } catch (e) {
    $("#titulo").textContent = "Não consegui ler o board";
    if (e.status === 401) {
      return telaCentro(`<b>O Trello não reconheceu a sessão.</b>
        A extensão usa o login que você já tem no navegador — confira se está
        logado em trello.com nesta mesma janela do Chrome.`);
    }
    return telaCentro(`<b>Algo deu errado ao falar com o Trello.</b>
      ${escapar(e.message || "")}`);
  }

  let idx = 0;
  grupos = (cards || []).map(c => {
    const lista = (c.attachments || []).map(a => ({
      idx: idx++,
      nome: a.fileName || a.name || "arquivo",
      bytes: a.bytes,
      url: a.url,
      cartao: c.name,
      arquivo: ehArquivo(a),
      marcado: true
    })).filter(i => i.arquivo);   // link não é arquivo: não há o que salvar
    return { nome: c.name, itens: lista };
  }).filter(g => g.itens.length);

  itens = grupos.flatMap(g => g.itens);

  if (!itens.length) {
    $("#titulo").textContent = board.name || "Board";
    return telaCentro("<b>Nenhum cartão deste board tem arquivo anexado.</b>Nada para baixar aqui.");
  }
  telaLista();
}

/* ---------- tela ---------- */
function telaLista() {
  const total = itens.reduce((s, i) => s + (i.bytes || 0), 0);
  $("#titulo").textContent = board.name || "Board";
  $("#sub").textContent = `${grupos.length} cartão${grupos.length === 1 ? "" : "es"} com anexo · `
    + `${itens.length} arquivo${itens.length === 1 ? "" : "s"}` + (total ? ` · ${kb(total)}` : "");

  let html = `<div class="aviso">Os arquivos vão para
    <code>Downloads/${escapar(nomeSeguro(board.name))}/</code>, numa pasta por cartão.</div>`;

  html += `<div class="marcar">
      <button id="mTodos">Marcar todos</button>
      <button id="dTodos">Desmarcar todos</button>
    </div>`;

  html += grupos.map((g, gi) => `
    <div class="grupo">
      <label class="cab">
        <input type="checkbox" data-g="${gi}" checked>
        <b>${escapar(g.nome)}</b>
        <span>${g.itens.length} anexo${g.itens.length === 1 ? "" : "s"}</span>
      </label>
      ${g.itens.map(i => `
        <label class="item">
          <input type="checkbox" data-i="${i.idx}" ${i.marcado ? "checked" : ""}>
          <span class="nome">
            <b>${escapar(i.nome)}</b>
            <span>${kb(i.bytes)}</span>
          </span>
          <span class="estado" id="e${i.idx}"></span>
        </label>`).join("")}
    </div>`).join("");

  $("#corpo").innerHTML = html;
  $("#rodape").hidden = false;

  $("#corpo").addEventListener("change", e => {
    const cb = e.target.closest("input[type=checkbox]");
    if (!cb) return;
    if (cb.dataset.g !== undefined) {
      const g = grupos[+cb.dataset.g];
      g.itens.forEach(i => {
        i.marcado = cb.checked;
        const el = $(`#corpo input[data-i="${i.idx}"]`);
        if (el) el.checked = cb.checked;
      });
    } else {
      itens[+cb.dataset.i].marcado = cb.checked;
      sincronizarCabecalhos();
    }
    atualizarBotao();
  });
  $("#mTodos").onclick = () => marcarTodos(true);
  $("#dTodos").onclick = () => marcarTodos(false);
  atualizarBotao();
}

function sincronizarCabecalhos() {
  grupos.forEach((g, gi) => {
    const cb = $(`#corpo input[data-g="${gi}"]`);
    if (!cb) return;
    const n = g.itens.filter(i => i.marcado).length;
    cb.checked = n === g.itens.length;
    cb.indeterminate = n > 0 && n < g.itens.length;
  });
}

function marcarTodos(v) {
  itens.forEach(i => i.marcado = v);
  $$("#corpo input[type=checkbox]").forEach(c => { c.checked = v; c.indeterminate = false; });
  atualizarBotao();
}

function atualizarBotao() {
  const n = itens.filter(i => i.marcado).length;
  $("#baixar").disabled = n === 0;
  $("#baixar").textContent = n === 0 ? "Baixar" : `Baixar ${n} arquivo${n === 1 ? "" : "s"}`;
}

/* ---------- baixar ----------
   Cada download é acompanhado até o fim: só vira ✓ quando o Chrome diz
   "complete". O Power-Up antigo carimbava sucesso logo depois de PEDIR o
   arquivo, e foi por isso que a falha passou meses despercebida. */
function baixarUm(item) {
  const caminho = [board.name, item.cartao, item.nome].map(nomeSeguro).join("/");
  return new Promise(resolve => {
    chrome.downloads.download(
      { url: item.url, filename: caminho, conflictAction: "uniquify" },
      id => {
        if (chrome.runtime.lastError || id === undefined) {
          return resolve({ ok: false, erro: (chrome.runtime.lastError || {}).message || "recusado pelo Chrome" });
        }
        const ouvir = delta => {
          if (delta.id !== id) return;
          if (delta.state && delta.state.current === "complete") {
            chrome.downloads.onChanged.removeListener(ouvir);
            resolve({ ok: true });
          } else if (delta.state && delta.state.current === "interrupted") {
            chrome.downloads.onChanged.removeListener(ouvir);
            resolve({ ok: false, erro: (delta.error && delta.error.current) || "interrompido" });
          }
        };
        chrome.downloads.onChanged.addListener(ouvir);
      }
    );
  });
}

async function baixarTudo() {
  const alvos = itens.filter(i => i.marcado);
  if (!alvos.length) return;

  $("#baixar").disabled = true;
  $$("#corpo input").forEach(c => c.disabled = true);
  const antigo = $("#diag-box"); if (antigo) antigo.remove();
  alvos.forEach(i => { i.erro = null;
    const el = $("#e" + i.idx); if (el) { el.textContent = "…"; el.className = "estado"; } });

  let feitos = 0, falhas = 0;
  const FILA = 4;   // o Chrome dá conta de mais, mas 4 mantém a barra de downloads legível
  const pendentes = alvos.slice();

  async function trabalhador() {
    while (pendentes.length) {
      const i = pendentes.shift();
      const r = await baixarUm(i);
      const el = $("#e" + i.idx);
      if (r.ok) {
        if (el) { el.textContent = "✓"; el.className = "estado ok"; }
      } else {
        falhas++; i.erro = r.erro;
        if (el) { el.textContent = r.erro; el.className = "estado erro"; }
      }
      feitos++;
      $("#progresso").textContent = `${feitos} de ${alvos.length}`;
    }
  }

  await Promise.all(Array.from({ length: Math.min(FILA, alvos.length) }, trabalhador));

  $("#progresso").innerHTML = falhas
    ? `<span class="erro">${falhas} falhou(ram)</span> · ${alvos.length - falhas} salvo${alvos.length - falhas === 1 ? "" : "s"}`
    : `<span class="ok">Pronto — ${alvos.length} arquivo${alvos.length === 1 ? "" : "s"} salvo${alvos.length === 1 ? "" : "s"}</span>`;
  if (falhas) mostrarDiagnostico();

  $("#baixar").disabled = false;
  $("#baixar").textContent = "Baixar de novo";
  $$("#corpo input").forEach(c => c.disabled = false);
}

function mostrarDiagnostico() {
  const ruins = itens.filter(i => i.erro);
  if (!ruins.length) return;
  const contagem = {};
  ruins.forEach(i => { contagem[i.erro] = (contagem[i.erro] || 0) + 1; });
  const causas = Object.entries(contagem)
    .map(([causa, n]) => `<li><b>${escapar(causa)}</b> — ${n} arquivo${n === 1 ? "" : "s"}</li>`).join("");
  const box = document.createElement("div");
  box.id = "diag-box"; box.className = "aviso ruim";
  box.innerHTML = `<b>Por que falhou:</b><ul>${causas}</ul>`;
  $("#corpo").prepend(box);
}

$("#baixar").onclick = baixarTudo;

carregar().catch(e => {
  console.error(e);
  telaCentro(`<b>Algo deu errado.</b> ${escapar(e && e.message || "")}`);
});
