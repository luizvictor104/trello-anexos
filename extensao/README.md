# AtDownloader — extensão do Chrome

Baixa os anexos de um board do Trello para a sua pasta de Downloads, com o
nome certo, numa pasta por cartão.

## Como instalar

1. Abra `chrome://extensions` no Chrome.
2. Ligue o **Modo do desenvolvedor** (canto superior direito).
3. Clique em **Carregar sem compactação** e escolha esta pasta (`extensao`).
4. Pronto. O ícone azul de download aparece na barra do Chrome — se não
   aparecer, clique na peça de quebra-cabeça e fixe o AtDownloader.

Não precisa de token, de chave de API nem de autorização. A extensão usa o
login que você já tem no navegador.

## Como usar

Com um board aberto na aba, clique no ícone: ele já lê aquele board. Se você
estiver em qualquer outra página, ele mostra a lista dos seus boards para
escolher.

Marque o que quiser e clique em Baixar. Os arquivos caem em
`Downloads/Nome do board/Nome do cartão/arquivo.png`.

## Por que a extensão funciona onde o Power-Up não funcionava

O Power-Up (a pasta de cima neste repositório) é uma página comum hospedada no
GitHub Pages, e esbarra em duas paredes que uma extensão não tem:

**1. O Trello decide se o arquivo é para salvar ou para exibir.** Todo arquivo
chega ao navegador com um cabeçalho `Content-Disposition` dizendo o que fazer
com ele. Medido em 03/08/2026: `application/pdf` vem como `attachment` e o
navegador salva; `image/png`, `image/jpeg`, `video/mp4`, `video/quicktime` e
`audio/mpeg` vêm **sem** o cabeçalho, e o navegador exibe em vez de salvar.
Como os boards de social media são quase só imagem e vídeo, o download direto
não salvava praticamente nada. Aqui isso não importa: `chrome.downloads`
salva o que mandarmos, com o nome que mandarmos, ignorando o cabeçalho.

**2. Uma página não pode ler a resposta de outro endereço.** Isso impedia
qualquer coisa que precisasse do conteúdo do arquivo, e não só da URL dele —
por exemplo juntar tudo num `.zip`. A extensão declara `https://trello.com/*`
em `host_permissions` e por isso pode ler, o que permite listar os cartões e
anexos pela sua sessão, sem token e sem tela de autorização.

Não existe opção de `.zip`: cada arquivo é gravado direto no disco pelo Chrome,
um a um, então não há limite de tamanho — os Reels de 100+ MB passam sem susto.
Um zip teria que ser montado inteiro na memória antes de gravar, e as pastas
por cartão já dão a organização que ele daria.

## O que ela pede de permissão, e por quê

| Permissão | Para quê |
|---|---|
| `downloads` | salvar os arquivos com nome e pasta escolhidos |
| `activeTab`, `tabs` | achar a aba do Trello e saber em que board você está |
| `scripting` | rodar a consulta à API de dentro da aba do Trello, que é o único jeito que a API aceita sem token |
| `cookies` | ler o token `dsc` da sua sessão, usado como plano B quando não há aba do Trello aberta |
| `trello.com`, `api.trello.com` | listar os cartões e anexos usando a sua sessão |

Ela não lê nenhum outro site, não manda nada para lugar nenhum e não guarda
nada. Todo o código está em `popup.js`.
