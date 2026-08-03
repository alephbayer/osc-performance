# Guia de Configuração — Notificações Push

## Visão Geral

O sistema funciona assim:
1. Mecânico abre o portal no celular → aceita notificações
2. Celular registra o dispositivo no Supabase
3. Gestor adiciona tarefa → servidor envia push para o celular do mecânico
4. Notificação aparece mesmo com o app fechado

---

## PASSO 1 — Gerar as chaves VAPID

As chaves VAPID são como um "certificado" que prova que os pushes vêm do seu servidor.
Você já tem um par de chaves gerado — use estas:

```
VAPID_PUBLIC_KEY=BKJ-KlRRdQuoTlqzgXxKu9wGT0Yg4utU_EB_BS2AXHBImh4O4iA76AU8OVm52dU2pxgBYDTp6CA4N6Wv5zG9jXM

VAPID_PRIVATE_KEY=BiiaDEiDrQyDfUMRFvrmovR6_EjyHAr3S8l0zbEowhI
```

⚠️ Guarde a PRIVATE_KEY em local seguro. Se perder, terá que resetar todos os dispositivos.

---

## PASSO 2 — Configurar no Vercel

A chave PÚBLICA precisa ir para o Vercel (o app React precisa dela).

1. Acesse https://vercel.com → seu projeto `osc-performance`
2. Clique em **Settings** (menu lateral)
3. Clique em **Environment Variables**
4. Clique em **Add New**
5. Preencha:
   - **Name:** `VITE_VAPID_PUBLIC_KEY`
   - **Value:** `BKJ-KlRRdQuoTlqzgXxKu9wGT0Yg4utU_EB_BS2AXHBImh4O4iA76AU8OVm52dU2pxgBYDTp6CA4N6Wv5zG9jXM`
   - Marque os ambientes: ✅ Production ✅ Preview ✅ Development
6. Clique em **Save**
7. Faça um novo deploy (ou ele acontece automaticamente no próximo push para o GitHub)

---

## PASSO 3 — Configurar no Supabase

O servidor precisa das DUAS chaves (pública e privada) para assinar os pushes.

1. Acesse https://supabase.com → seu projeto
2. No menu lateral, clique em **Edge Functions**
3. Clique em **Secrets** (ou "Manage Secrets")
4. Adicione cada variável abaixo clicando em **+ Add secret**:

| Nome | Valor |
|------|-------|
| `VAPID_PUBLIC_KEY` | `BKJ-KlRRdQuoTlqzgXxKu9wGT0Yg4utU_EB_BS2AXHBImh4O4iA76AU8OVm52dU2pxgBYDTp6CA4N6Wv5zG9jXM` |
| `VAPID_PRIVATE_KEY` | `BiiaDEiDrQyDfUMRFvrmovR6_EjyHAr3S8l0zbEowhI` |
| `VAPID_SUBJECT` | `mailto:contato@oscperformance.com.br` |

---

## PASSO 4 — Rodar a migration no Supabase

Isso cria a tabela que guarda os dispositivos dos mecânicos.

1. Acesse https://supabase.com → seu projeto
2. No menu lateral, clique em **SQL Editor**
3. Clique em **+ New query**
4. Copie e cole o conteúdo do arquivo `migration_028_push_subscriptions.sql`
5. Clique em **Run** (▶)
6. Deve aparecer "Success. No rows returned"

---

## PASSO 5 — Deploy da Edge Function

A Edge Function é o código que roda no servidor do Supabase para enviar os pushes.

**Opção A — Pelo terminal (recomendado):**

Instale o Supabase CLI caso não tenha:
```bash
brew install supabase/tap/supabase   # macOS
# ou: npm install -g supabase        # Windows/Linux
```

Faça login e conecte ao projeto:
```bash
supabase login
supabase link --project-ref lchfmoeyzgbepunetuch
```

Faça o deploy da função:
```bash
supabase functions deploy send-push
```

**Opção B — Pelo painel do Supabase:**

1. Acesse **Edge Functions** no painel
2. Clique em **+ New Function**
3. Nome: `send-push`
4. Cole o conteúdo do arquivo `supabase/functions/send-push/index.ts`
5. Clique em **Deploy**

---

## PASSO 6 — Subir o código no GitHub

Suba os arquivos novos/modificados normalmente:
- `public/sw.js` ← novo
- `src/App.jsx` ← modificado
- `src/supabase.js` ← modificado

O Vercel vai fazer o deploy automático.

---

## PASSO 7 — Testar

1. Abra o portal do mecânico em um celular (Android com Chrome ou iPhone com Safari, app instalado na tela inicial)
2. O banner "🔔 Ativar notificações?" deve aparecer
3. Toque em **Ativar** → aceite a permissão do sistema
4. No painel do gestor, adicione uma tarefa ao carro do mecânico
5. O mecânico deve receber a notificação em poucos segundos

---

## Observações importantes

**iOS:** Push só funciona se o app estiver instalado na tela inicial (Add to Home Screen). No Safari, compartilhar → "Adicionar à Tela de Início". Requer iOS 16.4+.

**Android:** Funciona no Chrome diretamente, sem precisar instalar. Requer Android 8+.

**Se a notificação não chegar:** Verifique se as chaves VAPID estão corretas nos dois lugares (Vercel e Supabase). Os valores precisam ser idênticos.
