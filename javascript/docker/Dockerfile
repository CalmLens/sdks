# The CalmLens CLI as a container image, built by .github/workflows/release-cli.yml from a
# release's linux executables (calmlens-linux-amd64 and calmlens-linux-arm64 in the build
# context). The executables need glibc, which the distroless base provides.
#
#   docker run --rm -e CALMLENS_API_KEY -e CALMLENS_PROJECT_ID -e CALMLENS_WEBHOOK_SECRET \
#     ghcr.io/calmlens/calmlens listen --forward-to http://host.docker.internal:3000/api/webhooks/calmlens
FROM gcr.io/distroless/cc-debian12:nonroot
ARG TARGETARCH
COPY --chmod=755 calmlens-linux-${TARGETARCH} /usr/local/bin/calmlens
ENTRYPOINT ["/usr/local/bin/calmlens"]
CMD ["--help"]
