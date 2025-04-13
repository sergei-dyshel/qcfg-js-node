import? '../../node_modules/@sergei-dyshel/eslint-config/export.just'
import? './node_modules/@sergei-dyshel/eslint-config/export.just'

import? '../../node_modules/@sergei-dyshel/prettier-config/export.just'
import? './node_modules/@sergei-dyshel/prettier-config/export.just'

import? '../../node_modules/@sergei-dyshel/typescript/export.just'
import? './node_modules/@sergei-dyshel/typescript/export.just'

import './export.just'

_default:
    just --list


build-build-cmd:
    tsx src/tools/build-cmd/main.ts src/tools/build-cmd/main.ts

build-qcfg-build:
    tsx src/tools/qcfg-build.ts build src/tools/qcfg-build.ts

gen-user-config-schema:
    build-cmd -r src/tools/gen-user-config-schema.ts -- user-config.schema.json
    prettier --write user-config.schema.json

build: build-build-cmd gen-user-config-schema
    build-cmd src/tools/* src/cmd/*
