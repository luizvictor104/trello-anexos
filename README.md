# AtDownloader — Power-Up para Trello

Baixa os anexos do Trello sem sair do board. Você marca o que quer e o navegador salva tudo na sua pasta de Downloads.

Duas portas de entrada:

**No cabeçalho do board** — botão `AtDownloader`. Lista todos os anexos do board agrupados por cartão. Dá para marcar arquivo por arquivo, ou o cartão inteiro de uma vez.

**Dentro de um cartão** — botão `Baixar anexos`, para quando você quer só aquele cartão. Atenção: na interface nova do Trello os botões de Power-Up ficam **escondidos atrás do ícone de foguete 🚀**, na barra no rodapé do cartão. Foi por isso que o botão do board virou o caminho principal.

## Arquivos

| Arquivo | Papel |
|---|---|
| `index.html` | Página conectora. É a URL que vai no admin do Trello. Não tem interface — só declara os botões. |
| `cartoes.html` | A janela do botão do board. |
| `baixar.html` | A janela do botão do cartão. |
| `js/config.js` | Nome do Power-Up e a chave de API. |
| `icone.svg` | Ícone dos botões. |

## Instalação

Precisa de duas coisas que só você pode fazer: **hospedar numa URL https** e **criar o Power-Up na sua conta**.

### 1. Hospede a pasta

Trello só carrega Power-Up por `https://`. GitHub Pages resolve de graça:

1. Crie um repositório e suba estes arquivos
2. Settings → Pages → Source: `main` / raiz
3. Anote a URL, por exemplo `https://luizvictor104.github.io/trello-anexos/`

### 2. Crie o Power-Up

1. Vá em [trello.com/apps/admin](https://trello.com/apps/admin) → **New**
2. Nome: `AtDownloader` — precisa ser **igual** ao `APP_NOME` em `js/config.js`. Escolha o Workspace.
3. Em **Iframe connector URL**, cole a URL do passo 1
4. Salve. **Só agora** a aba **Capabilities** aparece — sem a connector URL o Trello trata o app como integração de API, não como Power-Up.
5. Em **Capabilities**, ligue **`board-buttons`** e **`card-buttons`**

### 3. Use

No board: menu → Power-Ups → adicione o seu. O botão **AtDownloader** aparece no cabeçalho.

O Power-Up **não pede autorização** e **não usa token**. Ele lê os anexos pelo contexto que o Trello já entrega, e quem baixa é o seu navegador, autenticado pela sua própria sessão do Trello.

## Por que não sai um .zip

A primeira versão montava um zip único, com uma pasta por cartão. Funcionava em teste e **falhou no uso real**. Vale registrar o porquê, porque a armadilha é sutil.

Para zipar, o JavaScript precisa **ler os bytes** de cada anexo. Testei o preflight de CORS contra `api.trello.com` e ele liberava tudo: `access-control-allow-origin: *` e `Authorization` entre os cabeçalhos permitidos. Conclui que dava para buscar os arquivos de dentro do Power-Up.

Era o teste errado. **O preflight autoriza a entrada, não o caminho inteiro.** Na prática o `api.trello.com` aceita o pedido e **redireciona** o arquivo para o servidor de armazenamento, que não autoriza leitura por JavaScript. O navegador segue o redirecionamento e barra na chegada — `TypeError: Failed to fetch`, sem status.

Nada disso se resolve com chave, token ou permissão. As saídas seriam:

- **um intermediário** (tipo Cloudflare Worker) que busca o arquivo e devolve com a permissão que falta — traria o zip de volta, ao custo de mais uma peça na infraestrutura e do token passando por ela;
- **deixar o navegador baixar**, que é o que este Power-Up faz hoje.

O escritor de ZIP (`js/zip.js`) chegou a ser escrito e validado — gerava arquivos corretos, com nomes acentuados em UTF-8, subpastas e deduplicação. Foi removido junto com o resto do caminho do zip; está no histórico do git se um dia o intermediário existir.

## Como o download funciona

Arquivos vão num **iframe escondido**: o navegador recebe o arquivo e salva direto, sem abrir aba e sem esbarrar no bloqueador de pop-up. Anexos que são apenas **links** abrem em aba — num iframe eles só carregariam a página invisivelmente e nada chegaria a você.

Na primeira vez o navegador pergunta se pode *baixar vários arquivos*. É esperado; basta permitir uma vez.

Se por algum motivo os downloads não começarem, o rodapé tem **"Prefere abrir em abas?"** — sempre visível, como alternativa, não como mensagem de erro.

## Problemas conhecidos na configuração

| Sintoma | Causa | Correção |
|---|---|---|
| Aba **Capabilities** não existe | Iframe connector URL ainda não preenchida | Preencha e salve a connector URL |
| Botão não aparece no cartão | A interface nova do Trello esconde os botões atrás do ícone de **foguete 🚀** no rodapé do cartão | Clique no foguete |
| Botão não aparece no cabeçalho | Capability `board-buttons` desligada, ou conector em cache | Ligue em Capabilities e recarregue com Cmd+Shift+R |
| Mudança publicada não aparece | Cache do navegador nos arquivos do GitHub Pages | Cmd+Shift+R |

`Invalid return_url` era um problema da versão com token, que exigia preencher **Allowed Origins** na aba API Key. Sem token, ele não acontece mais.

## Limites

- Um arquivo por vez, na sua pasta de Downloads. Sem pastas por cartão — isso exigiria o zip.
- O botão aparece para quem pode editar o cartão (`condition: 'edit'`).
- Power-Up privado, preso ao Workspace onde foi criado. Para usar em outro Workspace, crie uma segunda listagem apontando para a mesma URL.
