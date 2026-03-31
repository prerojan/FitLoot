# Friends Online - Plano de Integração

## Estrutura pronta no Supabase

- `social.user_presence`
- `social.friend_activity_events`
- `social.friend_online_presence` (view)
- `compat.user_presence`
- `compat.friend_activity_events`

## Objetivo técnico

Trocar o critério atual de online (baseado em `user_progression.last_activity_date`) por presença em tempo real com heartbeat.

## Fluxo recomendado

1. Login/app open:
   - upsert em `social.user_presence` com `presence_status = 'online'`.
2. Heartbeat periódico (30-60s):
   - atualizar `last_heartbeat_at`, `last_seen_at`, `current_activity`.
3. App em background/logout:
   - atualizar `presence_status = 'offline'` e `last_seen_at`.
4. Lista de amigos:
   - usar `social.friend_online_presence` para `is_online`.
5. Feed social:
   - gravar eventos principais em `social.friend_activity_events`.

## Compatibilidade sem quebra

- Enquanto o Worker ainda estiver no D1, manter fallback atual.
- No cutover Supabase, priorizar `user_presence` e manter fallback para `last_activity_date` por uma janela de transição.

## Regras de visibilidade (RLS já aplicadas)

- `private`: somente o próprio usuário vê.
- `friends`: amigos aceitos veem.
- `public`: qualquer autenticado vê.
