export function validateDomain(value) {
  const input = String(value || '').trim();
  const hostnameRegex = /^(?:\*\.)?(?:[a-zA-Z0-9-]+\.)*[a-zA-Z0-9-]+$/;
  const ipv4Regex = /^(?:\d{1,3}\.){3}\d{1,3}$/;

  if (!input) return 'Domain wajib diisi';
  if (/[\/\s]/.test(input)) return 'Domain tidak boleh mengandung spasi atau slash';
  if (!hostnameRegex.test(input) && !ipv4Regex.test(input)) return 'Format domain tidak valid';
  return undefined;
}

export function validateUrl(value, label = 'URL') {
  const input = String(value || '').trim();
  if (!input) return `${label} wajib diisi`;

  try {
    const parsed = new URL(input);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return `${label} harus memakai http:// atau https://`;
    }
  } catch {
    return `${label} tidak valid`;
  }

  return undefined;
}

export function validateCloudflareHostname(value) {
  const domainValidation = validateDomain(value);
  if (domainValidation) return domainValidation;
  const input = String(value || '').trim();
  if (!input.includes('.')) return 'Hostname publik harus berupa subdomain atau domain penuh';
  return undefined;
}

export function validateTunnelName(value) {
  const input = String(value || '').trim();
  if (!input) return 'Nama tunnel wajib diisi';
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(input)) {
    return 'Nama tunnel hanya boleh berisi huruf, angka, titik, underscore, atau dash';
  }
  return undefined;
}
