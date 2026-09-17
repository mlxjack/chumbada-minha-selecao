# Minha Seleção — bridge site

Site estático "ponte" que permite aos catálogos **com preço** da Chumbada Oficial
compartilharem uma única lista de produtos ("Minha Seleção") entre si, mesmo
estando em subdomínios diferentes.

## Por que existe

Cada catálogo (iscas, anzóis, chumbadas, acessórios, óculos) é um site separado
em um subdomínio próprio de `chumbada.com.br`, sem backend/banco de dados. Como
`localStorage` não é compartilhado entre subdomínios diferentes, este site serve
como a única origem que efetivamente guarda a lista: todos os catálogos carregam
um iframe invisível apontando para `bridge.html` deste site, e conversam com ele
via `postMessage`. Como todos carregam o **mesmo** iframe (mesma origem), todos
enxergam o mesmo `localStorage` — e assim a lista fica sincronizada entre eles,
sem servidor.

## Arquivos

- `bridge.html` — dono do `localStorage` canônico. Só ele lê/escreve os dados.
- `client.js` — script único incluído em cada catálogo (`<script src="https://selecao.chumbada.com.br/client.js" defer></script>`).
  Cria o iframe, fala com `bridge.html`, e renderiza o botão flutuante, a gaveta
  lateral, a página cheia (usada pelo hub) e o envio para o WhatsApp.
- `index.html` — página de fallback caso alguém visite o domínio diretamente.

## Protocolo (postMessage)

Handshake: o `client.js` manda `{type:'HELLO'}` para a origem do bridge; o bridge
responde `{type:'READY'}` — a partir daí ele memoriza a origem do "pai" e só
aceita novas mensagens vindas dela.

Chamadas (`parent → bridge`), cada uma com `id` para casar com a resposta:

```js
{ id, type: 'GET_STATE' }
{ id, type: 'ADD_ITEM', payload: { catalog, productId, name, sku, variant, qty, unitPrice } }
{ id, type: 'ADJUST_QTY', payload: { id, delta } }    // delta é relativo (+1/-1); a ponte aplica sobre o valor atual, nunca o chamador — evita corrida em cliques rápidos. Resultado <= 0 remove o item.
{ id, type: 'REMOVE_ITEM', payload: { id } }
{ id, type: 'CLEAR' }
{ id, type: 'SET_STORE_NAME', payload: { storeName } }
```

Resposta (`bridge → parent`): `{ id, ok: true, state: { storeName, items } }`

Broadcast não solicitado (`bridge → parent`), disparado quando outra aba (mesmo
navegador, outro catálogo) muda a lista: `{ type: 'STATE_CHANGED', state }`.

## Identidade de item / dedupe

`id = catalog + '::' + (sku || productId) + '::' + variação normalizada`

Adicionar o mesmo produto+variação duas vezes soma a quantidade em vez de criar
uma linha duplicada. `acessórios` não tem SKU — usa `productId` (o `id` numérico
do produto) como chave.

## Lista de origens permitidas

`bridge.html` só aceita mensagens dos 6 domínios "com preço" (mais `localhost`
para testes locais — inofensivo, já que `event.origin` não pode ser falsificado
pelo conteúdo de uma página). Ao adicionar um novo catálogo com preço, é preciso
incluir seu domínio em `ALLOWED_ORIGINS` dentro de `bridge.html`.

## Escopo

Só os catálogos **com preço** participam (iscas, anzóis, chumbadas, acessórios,
óculos) + o hub `catalogosdeprecos.chumbada.com.br`. Os catálogos e o hub
**sem preço** não incluem este script e não têm a funcionalidade.
