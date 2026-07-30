# AtDownloader — Power-Up para Trello

Baixa anexos do Trello em **um .zip só**. Tem duas portas de entrada:

**No cabeçalho do board** — botão `AtDownloader`. Lista todos os cartões que têm anexo, você marca os que quiser, e baixa tudo de uma vez. Cada cartão vira uma pasta dentro do zip.

**Dentro de um cartão** — botão `Baixar anexos`, para quando você quer só aquele cartão. Atenção: na interface nova do Trello, os botões de Power-Up ficam **escondidos atrás do ícone de foguete 🚀**, na barra no rodapé do cartão. Foi por isso que o botão do board virou o caminho principal.

- Nomes com acento saem certos no Windows, Mac e Linux (flag UTF-8 do ZIP)
- Anexos de mesmo nome não se sobrescrevem: viram `arquivo (2).pdf`
- Anexo que é só um link vira um `_links.txt` dentro do zip
- Se algum falhar, os outros vão no zip mesmo assim, e aparece um Plano B

## Arquivos

| Arquivo | Papel |
|---|---|
| `index.html` | Página conectora. É a URL que vai no admin do Trello. Não tem interface — só declara o botão. |
| `cartoes.html` | A janela do botão do board: lista os cartões com anexo e baixa vários de uma vez. |
| `baixar.html` | A janela do botão do cartão: lista os anexos daquele cartão. |
| `js/config.js` | **O único arquivo que você edita.** Sua chave de API. |
| `js/zip.js` | Escritor de ZIP sem dependência externa. |
| `icone.svg` | Ícone do botão. |

## Instalação

Precisa de duas coisas que só você pode fazer: **hospedar numa URL https** e **criar o Power-Up na sua conta**.

### 1. Hospede a pasta

Trello só carrega Power-Up por `https://`. GitHub Pages resolve de graça:

1. Crie um repositório e suba estes arquivos
2. Settings → Pages → Source: `main` / raiz
3. Anote a URL: `https://seuusuario.github.io/trello-anexos/`

### 2. Crie o Power-Up

1. Vá em [trello.com/power-ups/admin](https://trello.com/power-ups/admin) → **New**
2. Nome: `AtDownloader` — precisa ser **igual** ao `APP_NOME` em `js/config.js`. Escolha o Workspace.
3. Em **Iframe connector URL**, cole a URL do passo 1 (a pasta, ou `.../index.html`)
4. Na aba **Capabilities**, ligue **`board-buttons`** e **`card-buttons`**

   A aba Capabilities só aparece **depois** que a Iframe connector URL está preenchida e salva — sem ela o Trello trata o app como integração de API, não como Power-Up.
5. Na aba **API Key**, clique em **Generate a new API key** e copie
6. **Ainda na aba API Key**, em **Allowed Origins**, adicione a origem de onde o Power-Up é servido:

   ```
   https://luizvictor104.github.io
   ```

   Só o domínio — sem caminho e sem barra final. **Esta etapa não é opcional:** com a lista de origens vazia, `authorize()` falha com *"Invalid return_url. The return URL should match the application's allowed origins"*. Curinga `*` foi descontinuado pelo Trello e é ignorado.

### 3. Cole a chave

Abra `js/config.js` e troque o texto de exemplo:

```js
const TRELLO_APP_KEY = "sua_chave_aqui";
```

Suba de novo. A chave de API do Trello identifica o Power-Up, não você — ela é pública por design e pode ficar no repositório. Quem dá acesso aos seus dados é o **token**, que nasce quando você clica em "Autorizar" e fica só no seu navegador.

### 4. Use

No board: menu → Power-Ups → adicione o seu. Abra um cartão com anexos e clique em **Baixar anexos**. Na primeira vez ele pede autorização de **leitura**.

## O que eu testei e o que não deu para testar

**Testado de verdade:**

- **O escritor de ZIP.** Gerei arquivos com acento, nomes duplicados, binário de 200 KB e arquivo vazio; conferi com `unzip -t` (CRC), com o `zipfile` do Python (nomes UTF-8 decodificando certo) e com o `ditto` do macOS. Binário confere byte a byte por sha256.
- **CORS da API do Trello.** O preflight em `api.trello.com/1/cards/.../attachments/.../download/...` responde `access-control-allow-origin: *` e `access-control-allow-headers: Authorization`. É isso que torna o zip possível de dentro do iframe — sem isso, só dava para abrir uma aba por anexo.
- **A tela inteira**, com o Trello simulado: listagem, tamanhos, marcar/desmarcar, progresso, um anexo falhando de propósito, o zip resultante (conferi as 5 entradas, o `(2)` do duplicado e o `_links.txt`) e o Plano B.

**Não deu para testar:** a chamada autenticada real. Ela exige conta no Trello, chave de API e a URL hospedada — as três coisas suas. Um detalhe em aberto: a resposta **401** que a API devolve não traz o cabeçalho CORS, embora o preflight traga. Se por acaso a resposta de sucesso também não trouxer, o `fetch` vai falhar e o **Plano B** entra automaticamente (abre cada anexo numa aba, autenticando pelo cookie da sua sessão). Você vai descobrir no primeiro clique: ou vem o zip, ou vem o Plano B.

## Problemas conhecidos na configuração

| Sintoma | Causa | Correção |
|---|---|---|
| `Invalid return_url` ao autorizar | Allowed Origins vazio na aba API Key | Adicione `https://luizvictor104.github.io` |
| Aba **Capabilities** não existe | Iframe connector URL ainda não preenchida — sem ela o Trello trata o app como integração de API, não Power-Up | Preencha e salve a connector URL |
| Botão não aparece no cartão | Não é bug: a interface nova do Trello esconde os botões de Power-Up atrás do ícone de **foguete 🚀** na barra do rodapé do cartão | Clique no foguete |
| Botão não aparece no cabeçalho do board | Capability `board-buttons` desligada, ou conector em cache | Ligue em Capabilities e recarregue com Cmd+Shift+R |
| Mudança publicada não aparece | Cache do navegador nos arquivos do GitHub Pages | Cmd+Shift+R |

## Limites

- Zip montado na memória do navegador. Acima de 500 MB o app avisa; acima de 4 GB o formato exigiria Zip64, que não implementei.
- Sem compressão (método "store"). Anexo de Trello é quase sempre jpg, png, pdf ou mp4 — já comprimidos. Recomprimir gastaria CPU para ganhar quase nada.
- O botão aparece para quem pode editar o cartão (`condition: 'edit'`).
- Power-Up privado, só do seu Workspace. Publicar no diretório do Trello exige e-mail de suporte e política de privacidade.
