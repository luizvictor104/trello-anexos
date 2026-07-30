/* ─────────────────────────────────────────────────────────────
   Escritor de ZIP mínimo, método "store" (sem compressão).

   Por que sem compressão: quase todo anexo de Trello já é
   comprimido (jpg, png, pdf, mp4, docx). Recomprimir gastaria
   CPU do navegador para ganhar ~0%. Sem compressão o arquivo
   sai na hora e o código cabe num arquivo só, sem dependência
   externa — o que importa num Power-Up, que roda dentro de um
   iframe do Trello.

   Formato: APPNOTE.TXT 6.3.x, seções 4.3.7 (local header),
   4.3.12 (central directory) e 4.3.16 (end of central dir).
   ───────────────────────────────────────────────────────────── */
(function (raiz) {
  "use strict";

  /* CRC-32 (IEEE 802.3), o mesmo que o ZIP exige */
  const TABELA = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = TABELA[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  /* data/hora no formato MS-DOS que o ZIP usa (resolução de 2 segundos) */
  function dataDos(d) {
    const ano = Math.max(1980, d.getFullYear());
    return {
      hora: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
      data: ((ano - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
    };
  }

  const utf8 = s => new TextEncoder().encode(s);

  function escritor(tamanho) {
    const buf = new Uint8Array(tamanho);
    const dv = new DataView(buf.buffer);
    let p = 0;
    return {
      buf,
      u16(v) { dv.setUint16(p, v, true); p += 2; },
      u32(v) { dv.setUint32(p, v >>> 0, true); p += 4; },
      bytes(b) { buf.set(b, p); p += b.length; },
      get pos() { return p; }
    };
  }

  /* Nome seguro dentro do zip: sem caminho absoluto, sem "..",
     sem os caracteres que quebram no Windows. */
  function nomeSeguro(nome) {
    return String(nome || "arquivo")
      .replace(/[\\/]+/g, "-")
      .replace(/[\x00-\x1f<>:"|?*]/g, "")
      .replace(/^\.+/, "")
      .trim()
      .slice(0, 180) || "arquivo";
  }

  /* Evita que dois anexos de mesmo nome se sobrescrevam:
     "nota.pdf", "nota (2).pdf", "nota (3).pdf" */
  function desduplicar(nomes) {
    const vistos = new Map();
    return nomes.map(n => {
      const chave = n.toLowerCase();
      if (!vistos.has(chave)) { vistos.set(chave, 1); return n; }
      const c = vistos.get(chave) + 1;
      vistos.set(chave, c);
      const ponto = n.lastIndexOf(".");
      return ponto > 0
        ? `${n.slice(0, ponto)} (${c})${n.slice(ponto)}`
        : `${n} (${c})`;
    });
  }

  /**
   * @param {Array<{nome:string, dados:Uint8Array, data?:Date}>} arquivos
   * @returns {Uint8Array} o zip pronto
   */
  function criarZip(arquivos) {
    const nomes = desduplicar(arquivos.map(a => nomeSeguro(a.nome)));
    const itens = arquivos.map((a, i) => {
      const nomeBytes = utf8(nomes[i]);
      const dados = a.dados instanceof Uint8Array ? a.dados : new Uint8Array(a.dados);
      return { nomeBytes, dados, crc: crc32(dados), dt: dataDos(a.data || new Date()) };
    });

    const TAM_LOCAL = 30, TAM_CENTRAL = 46, TAM_FIM = 22;
    let tamanho = TAM_FIM;
    for (const it of itens) {
      tamanho += TAM_LOCAL + it.nomeBytes.length + it.dados.length;
      tamanho += TAM_CENTRAL + it.nomeBytes.length;
    }

    const w = escritor(tamanho);
    const deslocamentos = [];

    // 4.3.7 — cabeçalho local + dados, para cada arquivo
    for (const it of itens) {
      deslocamentos.push(w.pos);
      w.u32(0x04034b50);
      w.u16(20);            // versão necessária
      w.u16(0x0800);        // bit 11: nome em UTF-8
      w.u16(0);             // método 0 = armazenado
      w.u16(it.dt.hora);
      w.u16(it.dt.data);
      w.u32(it.crc);
      w.u32(it.dados.length);   // comprimido
      w.u32(it.dados.length);   // original
      w.u16(it.nomeBytes.length);
      w.u16(0);             // sem campo extra
      w.bytes(it.nomeBytes);
      w.bytes(it.dados);
    }

    // 4.3.12 — diretório central
    const inicioCentral = w.pos;
    itens.forEach((it, i) => {
      w.u32(0x02014b50);
      w.u16(20);            // versão que gerou
      w.u16(20);            // versão necessária
      w.u16(0x0800);
      w.u16(0);
      w.u16(it.dt.hora);
      w.u16(it.dt.data);
      w.u32(it.crc);
      w.u32(it.dados.length);
      w.u32(it.dados.length);
      w.u16(it.nomeBytes.length);
      w.u16(0);             // extra
      w.u16(0);             // comentário
      w.u16(0);             // disco
      w.u16(0);             // atributos internos
      w.u32(0);             // atributos externos
      w.u32(deslocamentos[i]);
      w.bytes(it.nomeBytes);
    });
    const tamCentral = w.pos - inicioCentral;

    // 4.3.16 — fim do diretório central
    w.u32(0x06054b50);
    w.u16(0); w.u16(0);
    w.u16(itens.length);
    w.u16(itens.length);
    w.u32(tamCentral);
    w.u32(inicioCentral);
    w.u16(0);

    return w.buf;
  }

  /* O formato clássico guarda deslocamentos em 32 bits: acima de
     4 GB seria preciso Zip64, que não vale a complexidade aqui. */
  criarZip.LIMITE_BYTES = 4 * 1024 * 1024 * 1024 - 1;
  criarZip.nomeSeguro = nomeSeguro;

  if (typeof module !== "undefined" && module.exports) module.exports = { criarZip, crc32, nomeSeguro };
  else raiz.ZipSimples = { criarZip, crc32, nomeSeguro };
})(typeof self !== "undefined" ? self : this);
