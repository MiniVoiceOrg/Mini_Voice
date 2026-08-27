[🏠 Home](Home) · [Português](../Verificar-Releases)

# Verify Releases

Every release is signed with [Sigstore Cosign](https://docs.sigstore.dev/) (keyless, through GitHub Actions OIDC).

Download the artifact you want and also `checksums-sha256.txt`, `checksums-sha256.txt.sig` and `checksums-sha256.txt.crt` from the release.

```bash
sha256sum -c checksums-sha256.txt

cosign verify-blob \
  --signature checksums-sha256.txt.sig \
  --certificate checksums-sha256.txt.crt \
  --certificate-identity-regexp "https://github.com/MonkyOrg/Monky" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
  checksums-sha256.txt
```

This confirms the artifact came from the official pipeline and was not tampered with.

---
<sub>📝 This page is generated from [`wiki/`](https://github.com/MonkyOrg/Monky/tree/main/wiki) in the repository. Edits made directly in the Wiki will be overwritten — please open a Pull Request.</sub>
