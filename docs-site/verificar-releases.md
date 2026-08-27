# Verificar Releases

Todas as releases são assinadas com [Sigstore Cosign](https://docs.sigstore.dev/) (keyless, via OIDC do GitHub Actions).

Baixe o artefato desejado e também `checksums-sha256.txt`, `checksums-sha256.txt.sig` e `checksums-sha256.txt.crt` da release.

```bash
sha256sum -c checksums-sha256.txt

cosign verify-blob \
  --signature checksums-sha256.txt.sig \
  --certificate checksums-sha256.txt.crt \
  --certificate-identity-regexp "https://github.com/MonkyOrg/Monky" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
  checksums-sha256.txt
```

Isso confirma que o artefato veio do pipeline oficial e não foi adulterado.
