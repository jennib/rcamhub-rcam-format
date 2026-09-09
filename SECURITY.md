# Security Policy

This repository publishes the rcam `.rcam` file format: a JSON Schema, a
specification, example files, and a merge driver. It contains no server, no
network code, and no application.

## The merge driver

`rcam-merge.mjs` is the one executable artifact. It reads three `.rcam` files
passed as arguments and writes a merged file; it never touches the network and
trusts only its arguments. Treat a `.rcam` file from an untrusted source the
same way you would treat any untrusted input to a script you run.

## Reporting a vulnerability

Report privately via
https://github.com/jennib/rcamhub-rcam-format/security/advisories/new (or contact
maintainers). Include steps to reproduce and any file involved.
