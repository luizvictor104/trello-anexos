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

let board = null, listas = [], cartoes = [], itens = [];

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
    // "Social Media | Lighthouse" virava "Social Media  Lighthouse", com
    // espaço duplo: apagar a barra deixa o buraco. Vira travessão.
    .replace(/[|]/g, "—")
    .replace(/[<>:"?*\x00-\x1f]/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .slice(0, 120) || "arquivo";
}

/* ---------- ler o board ----------
   Três caminhos, do mais garantido para o menos. O primeiro existe porque o
   Trello protege a API contra pedidos vindos de fora do site (CSRF): mandar
   só o cookie não basta. Dentro de uma aba do trello.com o pedido é do
   próprio site, e aí funciona sempre — foi assim que testei a API a tarde
   toda. Os outros dois são para quando não há aba do Trello aberta. */

const diagnostico = [];   // guarda o que cada tentativa respondeu

async function abaDoTrello() {
  try {
    const abas = await chrome.tabs.query({ url: "https://trello.com/*" });
    return abas && abas.length ? abas[0] : null;
  } catch (e) { return null; }
}

/* 1) de dentro da página do Trello: mesmo site, sem CSRF, sem CORS */
async function viaPagina(tabId, caminhos) {
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    args: [caminhos],
    func: async (caminhos) => {
      const out = [];
      for (const c of caminhos) {
        const r = await fetch("/1" + c, { credentials: "include" });
        if (!r.ok) return { erro: "HTTP " + r.status };
        out.push(await r.json());
      }
      return { ok: out };
    }
  });
  return res && res.result;
}

/* 2) direto da extensão, com o token dsc na URL — é o que o próprio cliente
      web do Trello faz para provar que o pedido não é falsificado */
let _dsc;
async function pegarDsc() {
  if (_dsc !== undefined) return _dsc;
  try {
    const c = await chrome.cookies.get({ url: "https://trello.com/", name: "dsc" });
    _dsc = c ? c.value : "";
  } catch (e) { _dsc = ""; }
  return _dsc;
}

async function direto(caminho, comDsc) {
  let url = "https://api.trello.com/1" + caminho;
  if (comDsc) {
    const d = await pegarDsc();
    if (!d) return { erro: "sem o cookie dsc" };
    url += (caminho.includes("?") ? "&" : "?") + "dsc=" + encodeURIComponent(d);
  }
  const r = await fetch(url, { credentials: "include" });
  if (!r.ok) return { erro: "HTTP " + r.status };
  return { ok: [await r.json()] };
}

async function api(caminho) { return (await apiVarios([caminho]))[0]; }

async function apiVarios(caminhos) {
  const aba = await abaDoTrello();
  if (aba) {
    try {
      const r = await viaPagina(aba.id, caminhos);
      if (r && r.ok) return r.ok;
      diagnostico.push(`pela aba do Trello: ${(r && r.erro) || "sem resposta"}`);
    } catch (e) {
      diagnostico.push(`pela aba do Trello: ${e.message || e}`);
    }
  } else {
    diagnostico.push("pela aba do Trello: nenhuma aba do trello.com aberta");
  }

  for (const comDsc of [true, false]) {
    const saida = [];
    let falhou = null;
    for (const c of caminhos) {
      const r = await direto(c, comDsc);
      if (r.erro) { falhou = r.erro; break; }
      saida.push(r.ok[0]);
    }
    if (!falhou) return saida;
    diagnostico.push(`direto da extensão${comDsc ? " com dsc" : " só com cookie"}: ${falhou}`);
  }

  const e = new Error("nenhum caminho funcionou");
  e.diagnostico = true;
  throw e;
}

/* O Chrome relê o popup.js do disco toda vez que a janela abre, mas só relê o
   manifest.json quando a extensão é recarregada. Dá para ficar com código novo
   e permissões velhas — e aí chrome.scripting e chrome.cookies simplesmente
   não existem, o que produz um erro que não parece ter nada a ver. */
function permissoesFaltando() {
  const faltam = [];
  if (!chrome.scripting) faltam.push("scripting");
  if (!chrome.cookies) faltam.push("cookies");
  if (!chrome.tabs || !chrome.tabs.query) faltam.push("tabs");
  return faltam;
}

function telaPermissoes(faltam) {
  $("#titulo").textContent = "Falta recarregar a extensão";
  $("#sub").textContent = "";
  $("#rodape").hidden = true;
  return telaCentro(`<b>O Chrome ainda está com as permissões antigas.</b>
    Não chegaram: <code>${faltam.join("</code>, <code>")}</code>.
    <div class="aviso" style="text-align:left; margin-top:14px">
      O <code>popup.js</code> é lido do disco toda vez que esta janela abre, mas
      o <code>manifest.json</code> — onde ficam as permissões — só é relido
      quando a extensão é recarregada.
      <div style="margin-top:9px"><b>Feche o Chrome com ⌘Q e abra de novo.</b>
      Ou desligue e ligue o interruptor da extensão em
      <code>chrome://extensions</code>.</div>
    </div>`);
}

function telaSemSessao(titulo) {
  const faltam = permissoesFaltando();
  if (faltam.length) return telaPermissoes(faltam);
  $("#titulo").textContent = titulo;
  const linhas = diagnostico.map(d => `<li>${escapar(d)}</li>`).join("");
  return telaCentro(`<b>Não consegui ler seus dados do Trello.</b>
    O jeito mais confiável é deixar um board aberto numa aba e clicar no ícone
    a partir dele.
    <div class="aviso ruim" style="text-align:left; margin-top:14px">
      <b>O que eu tentei:</b><ul>${linhas}</ul>
    </div>`);
}

/* Se a aba já está num board, usa ele. Se não, mostra a lista para escolher —
   assim a extensão serve mesmo com o Trello fechado. */
async function carregar() {
  const faltam = permissoesFaltando();
  if (faltam.length) return telaPermissoes(faltam);

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
    if (e.diagnostico) return telaSemSessao("Não consegui listar seus boards");
    $("#titulo").textContent = "Não consegui falar com o Trello";
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
  let cards, listasApi;
  try {
    [board, listasApi, cards] = await apiVarios([
      `/boards/${shortLink}?fields=name`,
      `/boards/${shortLink}/lists?fields=name`,
      `/boards/${shortLink}/cards?fields=name,idList&attachments=true`
    ]);
  } catch (e) {
    if (e.diagnostico) return telaSemSessao("Não consegui ler o board");
    $("#titulo").textContent = "Não consegui ler o board";
    return telaCentro(`<b>Algo deu errado ao falar com o Trello.</b>
      ${escapar(e.message || "")}`);
  }

  /* A tela espelha o board: lista → cartão → anexo. A ordem das listas é a
     que o Trello devolve, que é a ordem das colunas na tela — mais fácil de
     reconhecer do que alfabética. Listas sem nenhum anexo somem: elas não
     têm o que baixar e só alongariam a rolagem. */
  let idx = 0, ci = 0;
  const porLista = new Map();
  (cards || []).forEach(c => {
    const arquivos = (c.attachments || []).map(a => ({
      idx: idx++,
      nome: a.fileName || a.name || "arquivo",
      bytes: a.bytes,
      url: a.url,
      cartao: c.name,
      arquivo: ehArquivo(a),
      marcado: true
    })).filter(i => i.arquivo);   // link não é arquivo: não há o que salvar
    if (!arquivos.length) return;
    if (!porLista.has(c.idList)) porLista.set(c.idList, []);
    porLista.get(c.idList).push({ ci: ci++, nome: c.name, itens: arquivos, aberto: false });
  });

  listas = (listasApi || [])
    .filter(l => porLista.has(l.id))
    .map(l => ({ nome: l.name, cartoes: porLista.get(l.id), aberto: false }));

  cartoes = listas.flatMap(l => l.cartoes);
  itens = cartoes.flatMap(c => c.itens);

  if (!itens.length) {
    $("#titulo").textContent = board.name || "Board";
    return telaCentro("<b>Nenhum cartão deste board tem arquivo anexado.</b>Nada para baixar aqui.");
  }
  telaLista();
}

/* ---------- tela ---------- */
const peso = arr => arr.reduce((s, i) => s + (i.bytes || 0), 0);
const plural = (n, s, p) => `${n} ${n === 1 ? s : (p || s + "s")}`;

function telaLista() {
  $("#titulo").textContent = board.name || "Board";
  $("#sub").textContent = [
    plural(listas.length, "lista"),
    plural(cartoes.length, "cartão", "cartões"),
    plural(itens.length, "arquivo"),
    kb(peso(itens))
  ].join(" · ");

  let html = `<div class="aviso">Os arquivos vão para
    <code>Downloads/${escapar(nomeSeguro(board.name))}/</code>, numa pasta por cartão.</div>`;

  html += `<div class="marcar">
      <button id="mTodos">Marcar todos</button>
      <button id="dTodos">Desmarcar todos</button>
    </div>`;

  /* Tudo nasce fechado. A caixa de marcar fica sempre FORA do botão que abre,
     senão marcar uma lista a expandiria junto. */
  html += listas.map((l, li) => `
    <div class="nivel lista">
      <div class="cab" id="lcab${li}">
        <input type="checkbox" data-l="${li}" checked title="Marcar a lista inteira">
        <button class="expandir" data-lx="${li}" aria-expanded="false">
          <span class="seta">▶</span>
          <b>${escapar(l.nome)}</b>
          <span class="conta">${plural(l.cartoes.length, "cartão", "cartões")} ·
            ${plural(l.cartoes.reduce((s, c) => s + c.itens.length, 0), "anexo")} ·
            ${kb(peso(l.cartoes.flatMap(c => c.itens)))}</span>
        </button>
      </div>
      <div class="filhos" id="lfilhos${li}" hidden>
        ${l.cartoes.map(c => `
        <div class="nivel cartao">
          <div class="cab" id="ccab${c.ci}">
            <input type="checkbox" data-c="${c.ci}" checked title="Marcar o cartão inteiro">
            <button class="expandir" data-cx="${c.ci}" aria-expanded="false">
              <span class="seta">▶</span>
              <b>${escapar(c.nome)}</b>
              <span class="conta">${plural(c.itens.length, "anexo")} · ${kb(peso(c.itens))}</span>
            </button>
          </div>
          <div class="filhos" id="cfilhos${c.ci}" hidden>
            ${c.itens.map(i => `
            <label class="item">
              <input type="checkbox" data-i="${i.idx}" ${i.marcado ? "checked" : ""}>
              <span class="nome">
                <b>${escapar(i.nome)}</b>
                <span>${kb(i.bytes)}</span>
              </span>
              <span class="estado" id="e${i.idx}"></span>
            </label>`).join("")}
          </div>
        </div>`).join("")}
      </div>
    </div>`).join("");

  $("#corpo").innerHTML = html;
  $("#rodape").hidden = false;

  $("#corpo").addEventListener("click", e => {
    const btn = e.target.closest("button.expandir");
    if (!btn) return;
    if (btn.dataset.lx !== undefined) {
      const l = listas[+btn.dataset.lx];
      alternar(l, btn, $("#lfilhos" + btn.dataset.lx), $("#lcab" + btn.dataset.lx));
    } else {
      const c = cartoes[+btn.dataset.cx];
      alternar(c, btn, $("#cfilhos" + btn.dataset.cx), $("#ccab" + btn.dataset.cx));
    }
  });

  $("#corpo").addEventListener("change", e => {
    const cb = e.target.closest("input[type=checkbox]");
    if (!cb) return;
    if (cb.dataset.l !== undefined) {
      listas[+cb.dataset.l].cartoes.forEach(c => marcarCartao(c, cb.checked));
    } else if (cb.dataset.c !== undefined) {
      marcarCartao(cartoes[+cb.dataset.c], cb.checked);
    } else {
      itens[+cb.dataset.i].marcado = cb.checked;
    }
    sincronizar();
    atualizarBotao();
  });

  $("#mTodos").onclick = () => marcarTodos(true);
  $("#dTodos").onclick = () => marcarTodos(false);
  sincronizar();
  atualizarBotao();
}

function alternar(no, btn, filhos, cab) {
  no.aberto = !no.aberto;
  filhos.hidden = !no.aberto;
  btn.setAttribute("aria-expanded", String(no.aberto));
  cab.toggleAttribute("aberto", no.aberto);
}

function marcarCartao(c, v) {
  c.itens.forEach(i => i.marcado = v);
  const el = $(`#corpo input[data-c="${c.ci}"]`);
  if (el) { el.checked = v; el.indeterminate = false; }
  c.itens.forEach(i => {
    const ei = $(`#corpo input[data-i="${i.idx}"]`);
    if (ei) ei.checked = v;
  });
}

/* Uma caixa de nível acima fica "meio marcada" quando só parte do que está
   dentro dela está marcado — é o que o Trello faz e o que se espera. */
function tresEstados(cb, marcados, total) {
  if (!cb) return;
  cb.checked = marcados === total;
  cb.indeterminate = marcados > 0 && marcados < total;
}

function sincronizar() {
  cartoes.forEach(c => {
    tresEstados($(`#corpo input[data-c="${c.ci}"]`),
      c.itens.filter(i => i.marcado).length, c.itens.length);
  });
  listas.forEach((l, li) => {
    const dentro = l.cartoes.flatMap(c => c.itens);
    tresEstados($(`#corpo input[data-l="${li}"]`),
      dentro.filter(i => i.marcado).length, dentro.length);
  });
}

function marcarTodos(v) {
  itens.forEach(i => i.marcado = v);
  $$("#corpo input[type=checkbox]").forEach(c => { c.checked = v; c.indeterminate = false; });
  atualizarBotao();
}

function atualizarBotao() {
  const marcados = itens.filter(i => i.marcado);
  const n = marcados.length;
  $("#baixar").disabled = n === 0;
  $("#baixar").textContent = n === 0 ? "Baixar" : `Baixar ${plural(n, "arquivo")}`;
  const zip = $("#porZip");
  zip.hidden = n === 0;
  zip.textContent = `Baixar num .zip (${kb(peso(marcados))})`;
  zip.disabled = false;
}
/* ---------- zip ----------
   Possível só aqui: montar o zip exige LER os bytes de cada anexo, e é
   exatamente essa leitura que o navegador bloqueia numa página comum. A
   extensão tem host_permissions para trello.com, então pode ler.

   Custa caro, e por isso não é o botão principal: o arquivo inteiro é montado
   na memória antes de ser gravado, nada é salvo até o último anexo chegar, e
   fechar esta janela no meio perde tudo. Baixar um a um não tem nenhum desses
   problemas. */
const LIMITE_ZIP = 700 * 1048576;

/* Os endpoints da API recusam com 400 quando o pedido vem de fora do site sem
   o token dsc. O endpoint do arquivo em si parece só olhar o cookie — o
   download por arquivo funciona sem dsc —, mas ler por fetch é outro caminho,
   então tenta sem e, se recusar, de novo com. */
async function lerAnexo(url) {
  let r = await fetch(url, { credentials: "include" });
  if (r.ok || (r.status !== 400 && r.status !== 401)) return r;
  const d = await pegarDsc();
  if (!d) return r;
  const comDsc = url + (url.includes("?") ? "&" : "?") + "dsc=" + encodeURIComponent(d);
  const r2 = await fetch(comDsc, { credentials: "include" });
  return r2.ok ? r2 : r;
}

async function baixarZip() {
  const alvos = itens.filter(i => i.marcado);
  if (!alvos.length) return;

  const soma = alvos.reduce((s, i) => s + (i.bytes || 0), 0);
  if (soma > LIMITE_ZIP) {
    $("#progresso").innerHTML = `<span class="erro">${kb(soma)} é demais para um zip
      no navegador.</span>`;
    const box = document.createElement("div");
    box.id = "diag-box"; box.className = "aviso ruim";
    box.innerHTML = `<b>O zip é montado inteiro na memória antes de ser gravado.</b>
      Com ${kb(soma)} o Chrome trava ou fica sem memória. Marque menos cartões,
      ou use o botão <b>Baixar</b>, que grava um arquivo por vez e não tem limite.`;
    const antigo = $("#diag-box"); if (antigo) antigo.remove();
    $("#corpo").prepend(box);
    return;
  }

  $("#baixar").disabled = true; $("#porZip").disabled = true;
  $$("#corpo input").forEach(c => c.disabled = true);
  const antigo = $("#diag-box"); if (antigo) antigo.remove();
  alvos.forEach(i => { i.erro = null;
    const el = $("#e" + i.idx); if (el) { el.textContent = "…"; el.className = "estado"; } });

  const prontos = [];
  let falhas = 0, feitos = 0;
  for (const i of alvos) {
    const el = $("#e" + i.idx);
    try {
      const r = await lerAnexo(i.url);
      if (!r.ok) throw new Error("HTTP " + r.status);
      prontos.push({ nome: i.nome, pasta: i.cartao, data: new Date(),
                     dados: new Uint8Array(await r.arrayBuffer()) });
      if (el) { el.textContent = "✓"; el.className = "estado ok"; }
    } catch (e) {
      falhas++; i.erro = e.message || String(e);
      if (el) { el.textContent = i.erro; el.className = "estado erro"; }
    }
    feitos++;
    $("#progresso").textContent = `lendo ${feitos} de ${alvos.length}`;
  }

  if (!prontos.length) {
    $("#progresso").innerHTML = `<span class="erro">Nenhum anexo pôde ser lido. O zip não foi criado.</span>`;
    mostrarDiagnostico();
    $("#baixar").disabled = false; $("#porZip").disabled = false;
    $$("#corpo input").forEach(c => c.disabled = false);
    return;
  }

  $("#progresso").textContent = "montando o zip…";
  const blob = new Blob([ZipSimples.criarZip(prontos)], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const r = await baixarUrl(url, nomeSeguro(board.name || "board") + " — anexos.zip");
  URL.revokeObjectURL(url);

  $("#progresso").innerHTML = r.ok
    ? (falhas
        ? `<span class="erro">${falhas} não entrou(ram)</span> · ${prontos.length} no zip`
        : `<span class="ok">Pronto — ${prontos.length} arquivo${prontos.length === 1 ? "" : "s"} no zip</span>`)
    : `<span class="erro">O zip ficou pronto mas não salvou: ${escapar(r.erro)}</span>`;
  if (falhas) mostrarDiagnostico();

  $("#baixar").disabled = false; $("#porZip").disabled = false;
  $$("#corpo input").forEach(c => c.disabled = false);
}

/* ---------- baixar ----------
   Cada download é acompanhado até o fim: só vira ✓ quando o Chrome diz
   "complete". O Power-Up antigo carimbava sucesso logo depois de PEDIR o
   arquivo, e foi por isso que a falha passou meses despercebida. */
function baixarUm(item) {
  return baixarUrl(item.url, [board.name, item.cartao, item.nome].map(nomeSeguro).join("/"));
}

function baixarUrl(url, caminho) {
  return new Promise(resolve => {
    chrome.downloads.download(
      { url, filename: caminho, conflictAction: "uniquify" },
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
$("#porZip").onclick = baixarZip;

carregar().catch(e => {
  console.error(e);
  telaCentro(`<b>Algo deu errado.</b> ${escapar(e && e.message || "")}`);
});
