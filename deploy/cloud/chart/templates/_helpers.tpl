{{- define "cloud.image" -}}
{{- if not (regexMatch "^sha256:[a-f0-9]{64}$" .digest) -}}
{{- fail "Both cloud and renderer require an explicit sha256 image digest" -}}
{{- end -}}
{{- printf "%s@%s" (required "image repository required" .repository) .digest -}}
{{- end -}}
