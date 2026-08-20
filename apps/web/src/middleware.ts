import { NextResponse, type NextRequest } from "next/server";

/**
 * Guarda leve de rotas do painel (edge): só checa presença do cookie —
 * a validação real da sessão acontece no layout do painel (Node).
 */
export function middleware(request: NextRequest) {
  const hasSession = request.cookies.has("cos_session");
  if (!hasSession) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Protege tudo, exceto: login, rotas públicas (assinar/orcamento/agendar/verificar),
     * webhooks/api, assets e arquivos estáticos.
     */
    "/((?!login|assinar|orcamento|agendar|verificar|api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
