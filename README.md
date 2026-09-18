# Minha Seleção — client script + backend

Deixa os catálogos **com preço** da Chumbada Oficial compartilharem uma
única lista de produtos ("Minha Seleção") entre si, mesmo estando em
subdomínios diferentes.

## Histórico: por que não é mais um iframe + localStorage

A primeira versão sincronizava os catálogos com um iframe invisível
(`bridge.html`) que guardava tudo em `localStorage` — sem servidor, sem
custo. Funcionava bem em navegador de computador, mas no Safari/iOS
(usado pela maioria dos clientes no celular) esbarrou numa limitação
conhecida do navegador: o Safari **particiona** o armazenamento de sites
"terceiros" (que é exatamente o que um iframe cross-domain é, do ponto de
vista de cada catálogo) por combinação de (site que está por cima, origem
do iframe) — cada catálogo enxergava sua própria cópia isolada — e **apaga
esse armazenamento sempre que o Safari é relançado** (trocar de app, tela
bloquear, o sistema liberar memória). Na prática, isso significava carrinho
esvaziando sozinho durante o uso normal no iPhone.

## Arquitetura atual

- **`client.js`** — o mesmo script único incluído em cada catálogo
  (`<script src="https://selecao.chumbada.com.br/client.js" defer></script>`).
  Continua cuidando do botão flutuante, da gaveta lateral, da página cheia
  do hub e do envio pro WhatsApp — só a camada de dados mudou.
- **Identificação do cliente**: um cookie (`chumbada_selecao_sid`) com
  `Domain=.chumbada.com.br`, criado pelo próprio `client.js` na primeira
  visita a qualquer catálogo. Por ser um cookie de primeira parte
  (same-site, criado pela própria página do catálogo, não por um iframe
  de outro domínio), ele não sofre nenhuma das restrições de terceiros do
  Safari — é só um cookie normal, do jeito que navegadores lidam bem há
  décadas.
- **`worker/`** — um Cloudflare Worker (gratuito) com uma **Durable
  Object** por sessão, que guarda a lista de produtos de cada cliente.
  Cada aba/catálogo manda esse código de sessão junto com cada pedido
  (`fetch` direto pro Worker, não mais `postMessage` pra um iframe). Como
  cada sessão tem sua própria Durable Object, e Durable Objects processam
  uma requisição de cada vez, várias abas do mesmo cliente adicionando
  produto ao mesmo tempo não conseguem mais se atropelar (nem precisa de
  trava manual, como era necessário no bridge antigo).

## Escopo

Só os catálogos **com preço** participam (iscas, anzóis, chumbadas,
acessórios, óculos) + o hub `catalogosdeprecos.chumbada.com.br`. Os
catálogos e o hub **sem preço** não incluem este script e não têm a
funcionalidade.

## Fazendo deploy do Worker

```bash
cd worker
npx wrangler deploy
```

Requer login prévio (`npx wrangler login`) numa conta Cloudflare com
acesso ao Worker `chumbada-minha-selecao` (subdomínio
`chumbada-oficial.workers.dev`).

## Identidade de item / dedupe

`id = catalog + '::' + (sku || productId) + '::' + variação normalizada`

Adicionar o mesmo produto+variação duas vezes soma a quantidade em vez de
criar uma linha duplicada. `acessórios` não tem SKU — usa `productId` (o
`id` numérico do produto) como chave.

## Lista de origens permitidas

O Worker (`worker/src/index.js`) só aceita requisições dos 6 domínios
"com preço" (mais `localhost` para testes locais — inofensivo, já que o
cabeçalho `Origin` não pode ser falsificado pelo conteúdo de uma página).
Ao adicionar um novo catálogo com preço, é preciso incluir seu domínio em
`ALLOWED_ORIGINS` ali.
