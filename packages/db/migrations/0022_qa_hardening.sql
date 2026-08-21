-- ═══════════════════════════════════════════════════════════════════
-- 0022 — Blindagens da caçada de QA: IP de assinatura pode ser nulo
--        (proxy que manda lixo em x-forwarded-for não pode impedir a
--        cliente de assinar — as demais evidências ficam).
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE document_signatures ALTER COLUMN ip DROP NOT NULL;
