# Rebuilds the browser (js_of_ocaml + WebAssembly) build of the Semgrep OSS engine from the last
# tag that still contains the js/ build tree (v1.81.0, 2024-07-24). Mirrors the upstream CI job
# .github/workflows/build-test-javascript.yml at that tag:
#   stage "ocaml": Alpine 3.18 + OCaml 4.14 (the retired returntocorp/ocaml:alpine image),
#                  opam deps, tree-sitter runtime, `dune build js --profile=release`
#   stage "wasm":  emscripten 3.1.51 compiles libpcre/libpcre2/libyaml/tree-sitter parsers to wasm
#                  and esbuild bundles engine + parsers
#   stage "export": just the dist/ directories
# Only the engine and the C# and Python parsers are built (Python is needed for metavariable-comparison).
ARG SEMGREP_TAG=v1.81.0
# opam-repository snapshot from the v1.81.0 release day (2024-07-24): reproduces the dependency universe of the CI build
ARG OPAM_REPO_SHA=4f54a686f4935d5a27d6746496f2c422170bfd9a

FROM ocaml/opam:alpine-3.18-ocaml-4.14 AS ocaml
ARG SEMGREP_TAG
ARG OPAM_REPO_SHA
USER root
# ALPINE_APK_DEPS_CORE from the v1.81.0 Makefile plus generic build tools
RUN apk add --no-cache pkgconf pcre-dev pcre2-dev gmp-dev libev-dev curl-dev openssl-libs-static zlib-static \
    bash curl git make gcc g++ musl-dev linux-headers libffi-dev python3 rsync
USER opam
WORKDIR /home/opam
RUN git clone --branch "$SEMGREP_TAG" --depth 1 https://github.com/semgrep/semgrep.git semgrep \
 && cd semgrep \
 && (git submodule update --init --recursive --depth 1 || git submodule update --init --recursive)
WORKDIR /home/opam/semgrep
# install-deps-for-semgrep-core (minus the static libcurl, which only matters for native binaries, and minus
# dev/required.opam, which only pins ocamlformat for the pre-commit hook)
RUN curl -sSL "https://codeload.github.com/ocaml/opam-repository/tar.gz/${OPAM_REPO_SHA}" | tar xz -C /home/opam \
 && mv "/home/opam/opam-repository-${OPAM_REPO_SHA}" /home/opam/opam-repository-pinned \
 && test "$(ls /home/opam/opam-repository-pinned/packages | wc -l)" -gt 3000 \
 && cd /home/opam/opam-repository-pinned \
 && { grep -q archive-mirrors repo && sed -i 's|^archive-mirrors:.*|archive-mirrors: "https://opam.ocaml.org/cache"|' repo || echo 'archive-mirrors: "https://opam.ocaml.org/cache"' >> repo; } \
 && cat repo
RUN eval "$(opam env)" \
 && opam repository set-url default /home/opam/opam-repository-pinned \
 && opam update -y \
 && cd libs/ocaml-tree-sitter-core && ./configure && ./scripts/install-tree-sitter-lib
RUN eval "$(opam env)" && opam install -y --deps-only ./ ./libs/ocaml-tree-sitter-core/tree-sitter.opam
# build-semgrep-jsoo, restricted to what the site needs
RUN eval "$(opam env)" && dune build js/engine js/languages/csharp js/languages/python --profile=release
# keep only the js_of_ocaml outputs so the next stage copies a small tree
RUN mkdir -p /home/opam/jsoo && cd _build/default/js \
 && find . -name '*.bc.js' | cpio -pdm /home/opam/jsoo \
 && cd /home/opam/semgrep && rm -rf _build && mkdir -p _build/default/js \
 && cp -R /home/opam/jsoo/. _build/default/js/ && ls -la _build/default/js/engine _build/default/js/languages/*

FROM --platform=linux/amd64 emscripten/emsdk:3.1.51 AS wasm-libs
COPY --from=ocaml /home/opam/semgrep /home/opam/semgrep
WORKDIR /home/opam/semgrep
RUN make -C js/libpcre build && make -C js/libpcre2 build && make -C js/libyaml build

FROM wasm-libs AS wasm
# npm >= 7 runs binaries as the owner of the working directory when invoked as root; the tree copied from
# the ocaml stage is owned by uid 1000, so `npx esbuild` could not write into root-owned dist/ directories.
RUN chown -R root:root js && make -C js/engine build
RUN make -C js/languages build-csharp build-python
RUN ls -la js/engine/dist js/languages/csharp/dist js/languages/python/dist

FROM scratch AS export
COPY --from=wasm /home/opam/semgrep/js/engine/dist /engine
COPY --from=wasm /home/opam/semgrep/js/languages/csharp/dist /csharp
COPY --from=wasm /home/opam/semgrep/js/languages/python/dist /python
