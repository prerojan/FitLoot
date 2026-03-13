# Integracao Cakto: checkout + webhook

## Visao geral do fluxo

1. O usuario autenticado escolhe plano e metodo de pagamento em `/checkout`.
2. O frontend chama `POST /api/checkout/start` ou `POST /api/onboarding`.
3. O Worker cria ou atualiza uma linha `pending` em `subscriptions` com:
   - `id` local do checkout
   - `user_id`
   - `plan_id`
   - `payment_method`
   - `checkout_url`
   - `product_id`
   - `metadata_json` com `fitloot_checkout_id`, `fitloot_user_id` e `fitloot_plan_id`
4. O Worker devolve a `checkout_url` rastreada da Cakto.
5. O frontend abre a Cakto e leva a aba atual para `/payment/pending`.
6. A tela pendente consulta `GET /api/subscription/status` com backoff.
7. Quando o webhook da Cakto confirma o pagamento, o Worker atualiza `subscriptions`, sincroniza `users.plan_id` e `users.plan_status`, e libera o acesso.
8. Na proxima verificacao automatica ou manual, o frontend redireciona para `/home`.

## Endpoints do projeto

- `POST /api/checkout/start`
  - Registra checkout pendente para usuarios que ja terminaram onboarding.
- `POST /api/onboarding`
  - Finaliza onboarding e cria checkout pendente na mesma transacao.
- `GET /api/subscription/status`
  - Retorna `plan_id`, `plan_status`, `payment_method`, `has_access`, `amount`, `checkout_url` e a ultima `subscription`.
- `POST /api/cakto/webhook`
  - Endpoint principal do webhook da Cakto.
- `POST /api/webhook/payment`
  - Alias legado apontando para a mesma logica do webhook da Cakto.

## Eventos tratados

- `purchase_approved`
  - Ativa acesso, atualiza `plan_id`, `plan_status = active`, datas e meio de pagamento.
- `purchase_refused`
  - Registra falha no historico do checkout e preserva o estado atual do usuario.
- `subscription_created`
  - Confirma a assinatura criada e ativa o acesso.
- `subscription_renewed`
  - Renova datas e mantem o plano ativo.
- `subscription_canceled`
  - Revoga acesso e marca a assinatura como cancelada.
- `checkout_abandonment`
  - Registra abandono e preserva o estado atual do usuario.

## Como o usuario e identificado

O Worker tenta identificar o usuario nesta ordem:

1. `fitloot_user_id` na query da `checkout_url`
2. `customer.email` enviado pela Cakto
3. Assinatura pendente mais recente do mesmo usuario/plano

Se nao for possivel identificar o usuario, o evento fica registrado em `cakto_webhook_events` com status `failed` para analise manual.

## Campos do payload usados pelo sistema

Do envelope:

- `event`
- `secret`
- `event_id` ou `id`

De `data`:

- `id`
- `status`
- `amount`, `baseAmount` ou `total`
- `paymentMethod`
- `checkoutUrl`
- `customer.email`
- `customer.name`
- `product.id`
- `product.name`
- `subscription.id`
- `paidAt`, `approvedAt`, `createdAt`
- `due_date`, `expiresAt`, `subscription.currentPeriodEnd`, `subscription.nextBillingAt`

## Integracao com a API da Cakto

O Worker usa:

- Token OAuth2: `POST https://api.cakto.com.br/public_api/token/`
- Buscar pedido por ID: `GET https://api.cakto.com.br/public_api/orders/{id}/`
- Buscar ultimo pedido por cliente: `GET https://api.cakto.com.br/public_api/orders/?customer={email}&ordering=-createdAt&limit=1`

O token fica em cache em memoria no Worker e so e renovado perto da expiracao.

## Como registrar o webhook na Cakto

1. Gere um token OAuth2 da Cakto.
2. Crie o webhook apontando para:
   - Producao: `https://SEU-WORKER/api/cakto/webhook`
3. Inclua os eventos:
   - `purchase_approved`
   - `purchase_refused`
   - `subscription_created`
   - `subscription_renewed`
   - `subscription_canceled`
   - `checkout_abandonment`
4. Configure o segredo para bater com `CAKTO_WEBHOOK_SECRET`.

Exemplo de criacao pela API da Cakto:

```bash
curl -X POST "https://api.cakto.com.br/public_api/webhooks/" \
  -H "Authorization: Bearer $CAKTO_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "FitLoot Checkout",
    "url": "https://SEU-WORKER/api/cakto/webhook",
    "events": [
      "purchase_approved",
      "purchase_refused",
      "subscription_created",
      "subscription_renewed",
      "subscription_canceled",
      "checkout_abandonment"
    ],
    "secret": "'"$CAKTO_WEBHOOK_SECRET"'"
  }'
```

## Como testar com evento de teste da Cakto

1. Descubra o ID do webhook criado:

```bash
curl "https://api.cakto.com.br/public_api/webhooks/" \
  -H "Authorization: Bearer $CAKTO_ACCESS_TOKEN"
```

2. Dispare um evento de teste:

```bash
curl -X POST "https://api.cakto.com.br/public_api/webhooks/event_test/WEBHOOK_ID/?event_id=purchase_approved" \
  -H "Authorization: Bearer $CAKTO_ACCESS_TOKEN"
```

3. Confira o processamento no banco:
   - tabela `cakto_webhook_events`
   - tabela `subscriptions`
   - tabela `users`

## Como reenviar um evento que falhou

1. Liste o historico do webhook:

```bash
curl "https://api.cakto.com.br/public_api/webhooks/history/" \
  -H "Authorization: Bearer $CAKTO_ACCESS_TOKEN"
```

2. Reenvie o evento pelo `history_id`:

```bash
curl -X POST "https://api.cakto.com.br/public_api/webhooks/history/HISTORY_ID/resend/" \
  -H "Authorization: Bearer $CAKTO_ACCESS_TOKEN"
```

3. Confira se o status mudou para `processed` em `cakto_webhook_events`.

## Variaveis de ambiente

Local:

- `CAKTO_CLIENT_ID`
- `CAKTO_CLIENT_SECRET`
- `CAKTO_WEBHOOK_SECRET`

Producoes Cloudflare:

- adicione as mesmas variaveis no Worker via dashboard ou `wrangler secret put`

O frontend nunca recebe `client_id`, `client_secret` nem `webhook_secret`.
