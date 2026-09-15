/**
 * Cliente da WhatsApp Business Platform (Cloud API oficial da Meta).
 * Um número = um phone_number_id + token permanente de System User.
 * Regras da API oficial que o resto do sistema respeita:
 *  - texto livre só dentro da janela de 24h aberta pela cliente;
 *  - fora dela, apenas templates aprovados (cobrados por categoria);
 *  - webhooks assinados com HMAC-SHA256 (App Secret).
 */

export interface MetaConfig {
  accessToken: string;
  phoneNumberId: string;
  wabaId?: string | null;
  graphVersion?: string;
}

export class MetaApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    /** Código da Meta (ex.: 131047 janela expirada, 190 token inválido). */
    public readonly code: number | null,
    public readonly details?: string,
  ) {
    super(message);
    this.name = "MetaApiError";
  }
}

export interface MetaTemplateSpec {
  name: string;
  language: string;
  category: "UTILITY" | "MARKETING";
  bodyText: string;
  bodyExamples: string[];
  /** Botão de link com sufixo dinâmico: url termina em {{1}}. */
  buttonUrl?: { text: string; url: string; example: string };
}

export interface MetaTemplateStatus {
  id: string;
  name: string;
  status: string;
  category: string;
  language: string;
  rejectedReason: string | null;
}

/** Parâmetro de template: sem quebras de linha/tabs, sem espaços duplos, tamanho limitado. */
export function sanitizeTemplateParam(value: string, max = 900): string {
  const clean = value.replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim();
  return (clean || "-").slice(0, max);
}

/** wa_id da Meta (5511999998888) → remoteJid do sistema (5511999998888@s.whatsapp.net). */
export function waIdToJid(waId: string): string {
  return `${waId.replace(/\D/g, "")}@s.whatsapp.net`;
}

export class MetaCloudClient {
  private readonly base: string;

  constructor(private readonly config: MetaConfig) {
    this.base = `https://graph.facebook.com/${config.graphVersion ?? "v23.0"}`;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.config.accessToken}`,
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = text;
    }
    if (!res.ok) {
      const err = (json as { error?: { message?: string; code?: number; error_data?: { details?: string } } })
        ?.error;
      throw new MetaApiError(
        `Meta ${method} ${path} → ${res.status}${err?.code ? ` (código ${err.code})` : ""}: ${err?.message ?? "erro"}`,
        res.status,
        typeof err?.code === "number" ? err.code : null,
        err?.error_data?.details,
      );
    }
    return json as T;
  }

  /** Dados do número — também serve como teste de token + phone_number_id. */
  async getPhoneNumber(): Promise<{
    displayPhoneNumber: string | null;
    verifiedName: string | null;
    qualityRating: string | null;
  }> {
    const r = await this.request<{
      display_phone_number?: string;
      verified_name?: string;
      quality_rating?: string;
    }>("GET", `/${this.config.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`);
    return {
      displayPhoneNumber: r.display_phone_number ?? null,
      verifiedName: r.verified_name ?? null,
      qualityRating: r.quality_rating ?? null,
    };
  }

  /** Assina o app nos webhooks da conta (sem isso, nenhum evento chega). */
  async subscribeApp(): Promise<void> {
    if (!this.config.wabaId) return;
    await this.request("POST", `/${this.config.wabaId}/subscribed_apps`);
  }

  async sendText(to: string, text: string): Promise<{ waMessageId?: string }> {
    const r = await this.request<{ messages?: { id?: string }[] }>(
      "POST",
      `/${this.config.phoneNumberId}/messages`,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: to.replace(/\D/g, ""),
        type: "text",
        text: { body: text, preview_url: false },
      },
    );
    return { waMessageId: r.messages?.[0]?.id };
  }

  async sendTemplate(
    to: string,
    template: { name: string; language: string; bodyParams: string[]; buttonUrlParam?: string | null },
  ): Promise<{ waMessageId?: string }> {
    const components: unknown[] = [];
    if (template.bodyParams.length > 0) {
      components.push({
        type: "body",
        parameters: template.bodyParams.map((p) => ({ type: "text", text: sanitizeTemplateParam(p) })),
      });
    }
    if (template.buttonUrlParam) {
      components.push({
        type: "button",
        sub_type: "url",
        index: "0",
        parameters: [{ type: "text", text: template.buttonUrlParam }],
      });
    }
    const r = await this.request<{ messages?: { id?: string }[] }>(
      "POST",
      `/${this.config.phoneNumberId}/messages`,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: to.replace(/\D/g, ""),
        type: "template",
        template: {
          name: template.name,
          language: { code: template.language },
          components,
        },
      },
    );
    return { waMessageId: r.messages?.[0]?.id };
  }

  /** Marca a mensagem da cliente como lida e mostra "digitando..." (some ao enviar ou em 25s). */
  async markReadTyping(customerMessageId: string): Promise<void> {
    await this.request("POST", `/${this.config.phoneNumberId}/messages`, {
      messaging_product: "whatsapp",
      status: "read",
      message_id: customerMessageId,
      typing_indicator: { type: "text" },
    });
  }

  async getMediaUrl(mediaId: string): Promise<{ url: string; mimeType: string | null }> {
    const r = await this.request<{ url: string; mime_type?: string }>(
      "GET",
      `/${mediaId}?phone_number_id=${this.config.phoneNumberId}`,
    );
    return { url: r.url, mimeType: r.mime_type ?? null };
  }

  async downloadMedia(url: string): Promise<Buffer> {
    const res = await fetch(url, { headers: { authorization: `Bearer ${this.config.accessToken}` } });
    if (!res.ok) throw new MetaApiError(`download de mídia → ${res.status}`, res.status, null);
    return Buffer.from(await res.arrayBuffer());
  }

  async listTemplates(): Promise<MetaTemplateStatus[]> {
    if (!this.config.wabaId) return [];
    const out: MetaTemplateStatus[] = [];
    let path: string | null =
      `/${this.config.wabaId}/message_templates?fields=id,name,status,category,language,rejected_reason&limit=200`;
    while (path) {
      const r: {
        data?: { id: string; name: string; status: string; category: string; language: string; rejected_reason?: string }[];
        paging?: { next?: string };
      } = await this.request("GET", path);
      for (const t of r.data ?? []) {
        out.push({
          id: t.id,
          name: t.name,
          status: t.status,
          category: t.category,
          language: t.language,
          rejectedReason: t.rejected_reason && t.rejected_reason !== "NONE" ? t.rejected_reason : null,
        });
      }
      path = r.paging?.next ? r.paging.next.replace(this.base, "") : null;
      if (path && path.startsWith("http")) path = null;
    }
    return out;
  }

  /** Cria o template na conta (aprovação da Meta leva até 24h). */
  async createTemplate(spec: MetaTemplateSpec): Promise<{ id: string; status: string; category: string }> {
    if (!this.config.wabaId) throw new MetaApiError("WABA ID ausente", 400, null);
    const components: unknown[] = [
      {
        type: "BODY",
        text: spec.bodyText,
        ...(spec.bodyExamples.length > 0 ? { example: { body_text: [spec.bodyExamples] } } : {}),
      },
    ];
    if (spec.buttonUrl) {
      components.push({
        type: "BUTTONS",
        buttons: [
          { type: "URL", text: spec.buttonUrl.text, url: spec.buttonUrl.url, example: [spec.buttonUrl.example] },
        ],
      });
    }
    return this.request("POST", `/${this.config.wabaId}/message_templates`, {
      name: spec.name,
      language: spec.language,
      category: spec.category,
      allow_category_change: true,
      components,
    });
  }
}
