import { decryptSensitive } from "@clinicaos/core/crypto";
import { MetaCloudClient } from "@clinicaos/whatsapp";

/** Cliente da API oficial para um número 'meta' (token cifrado no banco). */
export function metaClientFor(inst: {
  metaPhoneNumberId: string | null;
  metaWabaId: string | null;
  metaAccessTokenEnc: string | null;
}): MetaCloudClient | null {
  const key = process.env.SENSITIVE_DATA_KEY;
  if (!inst.metaPhoneNumberId || !inst.metaAccessTokenEnc || !key) return null;
  let token: string;
  try {
    token = decryptSensitive(inst.metaAccessTokenEnc, key);
  } catch {
    return null;
  }
  return new MetaCloudClient({
    accessToken: token,
    phoneNumberId: inst.metaPhoneNumberId,
    wabaId: inst.metaWabaId,
    graphVersion: process.env.META_GRAPH_VERSION,
  });
}
