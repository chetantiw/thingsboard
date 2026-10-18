// SPDX-FileCopyrightText: Copyright MuTech Automation
// SPDX-License-Identifier: Apache-2.0
package org.thingsboard.server.controller;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.thingsboard.common.util.JacksonUtil;
import org.thingsboard.server.common.data.AdminSettings;
import org.thingsboard.server.common.data.Customer;
import org.thingsboard.server.common.data.exception.ThingsboardErrorCode;
import org.thingsboard.server.common.data.exception.ThingsboardException;
import org.thingsboard.server.common.data.id.CustomerId;
import org.thingsboard.server.common.data.id.TenantId;
import org.thingsboard.server.common.data.security.Authority;
import org.thingsboard.server.dao.settings.AdminSettingsService;
import org.thingsboard.server.queue.util.TbCoreComponent;
import org.thingsboard.server.service.security.model.SecurityUser;
import org.thingsboard.server.service.security.permission.Operation;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * MuTech-IoT white labeling: a brand (title, logos, colors, login texts, footer) for the whole platform,
 * for a tenant and for a customer. A user sees the system brand overridden by their tenant's brand,
 * overridden by their customer's brand. A tenant or customer brand can name domains; the login page
 * served on such a domain shows that brand.
 * <p>
 * Brands are stored as admin settings (tenant-scoped for tenants and customers), so no schema change is needed.
 */
@RestController
@TbCoreComponent
@RequestMapping("/api")
public class MutechBrandingController extends BaseController {

    static final String BRANDING_KEY = "mtBranding";
    static final String CUSTOMER_BRANDING_KEY_PREFIX = "mtBranding:customer:";
    static final String DOMAINS_KEY = "mtBrandingDomains";

    private static final Set<String> TEXT_FIELDS = Set.of("appTitle", "loginHeadline", "loginSubtitle", "footerText", "poweredByText");
    private static final Set<String> IMAGE_FIELDS = Set.of("logoUrl", "emblemUrl", "faviconUrl", "loginLogoUrl", "loginBackgroundUrl");
    private static final Set<String> COLOR_FIELDS = Set.of("primaryColor", "accentColor");
    private static final Set<String> FLAG_FIELDS = Set.of("hidePoweredBy", "hideHelpLinks");
    private static final String DOMAINS_FIELD = "domains";

    private static final int MAX_TEXT_LENGTH = 500;
    private static final int MAX_IMAGE_LENGTH = 2 * 1024 * 1024;
    private static final int MAX_DOMAINS = 10;
    private static final Pattern COLOR_PATTERN = Pattern.compile("^#[0-9a-fA-F]{6}$");
    private static final Pattern IMAGE_PATTERN = Pattern.compile(
            "^(data:image/(png|jpeg|gif|webp|svg\\+xml|x-icon|vnd\\.microsoft\\.icon);base64,[A-Za-z0-9+/=]+"
                    + "|https?://[^\\s\"'<>()]+|/api/images/[^\\s\"'<>()]+|/assets/[^\\s\"'<>()]+)$");
    private static final Pattern DOMAIN_PATTERN = Pattern.compile("^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$");

    @Autowired
    private AdminSettingsService adminSettingsService;

    // Login page brand for the domain the page is served on.
    @GetMapping("/noauth/mutech/branding")
    public JsonNode getLoginBranding(@RequestParam(value = "domain", required = false) String domain, HttpServletRequest request) {
        String host = normalizeDomain(domain != null ? domain : request.getServerName());
        ObjectNode branding = loadSystemBranding();
        String owner = host != null ? findDomainOwner(host) : null;
        if (owner != null) {
            String[] parts = owner.split(":");
            try {
                TenantId tenantId = TenantId.fromUUID(UUID.fromString(parts[1]));
                merge(branding, loadBranding(tenantId, BRANDING_KEY));
                if ("customer".equals(parts[0]) && parts.length == 3) {
                    merge(branding, loadBranding(tenantId, CUSTOMER_BRANDING_KEY_PREFIX + parts[2]));
                }
            } catch (IllegalArgumentException ignored) {
                // A malformed index entry falls back to the system brand.
            }
        }
        branding.remove(DOMAINS_FIELD);
        return branding;
    }

    // Brand of the signed-in user: system, then tenant, then customer.
    @PreAuthorize("isAuthenticated()")
    @GetMapping("/mutech/branding")
    public JsonNode getCurrentBranding() throws ThingsboardException {
        SecurityUser user = getCurrentUser();
        ObjectNode branding = loadSystemBranding();
        if (user.getAuthority() != Authority.SYS_ADMIN) {
            merge(branding, loadBranding(user.getTenantId(), BRANDING_KEY));
            if (user.getAuthority() == Authority.CUSTOMER_USER && user.getCustomerId() != null && !user.getCustomerId().isNullUid()) {
                merge(branding, loadBranding(user.getTenantId(), customerKey(user.getCustomerId())));
            }
        }
        branding.remove(DOMAINS_FIELD);
        return branding;
    }

    // The brand stored at one level, and what that level inherits from the levels above it.
    @PreAuthorize("hasAnyAuthority('SYS_ADMIN', 'TENANT_ADMIN')")
    @GetMapping("/mutech/branding/settings")
    public JsonNode getBrandingSettings(@RequestParam("level") String level,
                                        @RequestParam(value = "tenantId", required = false) String tenantId,
                                        @RequestParam(value = "customerId", required = false) String customerId) throws ThingsboardException {
        Target target = resolveTarget(level, tenantId, customerId, Operation.READ);
        ObjectNode inherited = loadSystemBranding();
        if (target.customerId != null) {
            merge(inherited, loadBranding(target.tenantId, BRANDING_KEY));
        }
        if (target.tenantId.isSysTenantId()) {
            inherited = JacksonUtil.newObjectNode();
        }
        inherited.remove(DOMAINS_FIELD);
        ObjectNode result = JacksonUtil.newObjectNode();
        result.set("branding", loadBranding(target.tenantId, target.key));
        result.set("inherited", inherited);
        return result;
    }

    @PreAuthorize("hasAnyAuthority('SYS_ADMIN', 'TENANT_ADMIN')")
    @PostMapping("/mutech/branding/settings")
    public JsonNode saveBrandingSettings(@RequestParam("level") String level,
                                         @RequestParam(value = "tenantId", required = false) String tenantId,
                                         @RequestParam(value = "customerId", required = false) String customerId,
                                         @RequestBody JsonNode body) throws ThingsboardException {
        Target target = resolveTarget(level, tenantId, customerId, Operation.WRITE);
        ObjectNode branding = validate(body, target.domainOwner != null);
        synchronized (MutechBrandingController.class) {
            updateDomainIndex(target.domainOwner, branding.has(DOMAINS_FIELD) ? (ArrayNode) branding.get(DOMAINS_FIELD) : null);
            AdminSettings settings = adminSettingsService.findAdminSettingsByTenantIdAndKey(target.tenantId, target.key);
            if (settings == null) {
                settings = new AdminSettings();
                settings.setTenantId(target.tenantId);
                settings.setKey(target.key);
            }
            settings.setJsonValue(branding);
            adminSettingsService.saveAdminSettings(target.tenantId, settings);
        }
        return branding;
    }

    @PreAuthorize("hasAnyAuthority('SYS_ADMIN', 'TENANT_ADMIN')")
    @DeleteMapping("/mutech/branding/settings")
    public void deleteBrandingSettings(@RequestParam("level") String level,
                                       @RequestParam(value = "tenantId", required = false) String tenantId,
                                       @RequestParam(value = "customerId", required = false) String customerId) throws ThingsboardException {
        Target target = resolveTarget(level, tenantId, customerId, Operation.WRITE);
        synchronized (MutechBrandingController.class) {
            updateDomainIndex(target.domainOwner, null);
            adminSettingsService.deleteAdminSettingsByTenantIdAndKey(target.tenantId, target.key);
        }
    }

    private record Target(TenantId tenantId, CustomerId customerId, String key, String domainOwner) {
    }

    private Target resolveTarget(String level, String tenantIdStr, String customerIdStr, Operation operation) throws ThingsboardException {
        SecurityUser user = getCurrentUser();
        switch (level == null ? "" : level) {
            case "system":
                if (user.getAuthority() != Authority.SYS_ADMIN) {
                    throw forbidden();
                }
                return new Target(TenantId.SYS_TENANT_ID, null, BRANDING_KEY, null);
            case "tenant": {
                TenantId tenantId;
                if (user.getAuthority() == Authority.SYS_ADMIN) {
                    checkParameter("tenantId", tenantIdStr);
                    tenantId = TenantId.fromUUID(toUUID(tenantIdStr));
                } else {
                    tenantId = user.getTenantId();
                    if (tenantIdStr != null && !tenantId.getId().equals(toUUID(tenantIdStr))) {
                        throw forbidden();
                    }
                }
                // Tenant admins can only read their Tenant entity, but own their brand.
                checkTenantId(tenantId, user.getAuthority() == Authority.SYS_ADMIN ? operation : Operation.READ);
                return new Target(tenantId, null, BRANDING_KEY, "tenant:" + tenantId.getId());
            }
            case "customer": {
                if (user.getAuthority() != Authority.TENANT_ADMIN) {
                    throw forbidden();
                }
                checkParameter("customerId", customerIdStr);
                CustomerId customerId = new CustomerId(toUUID(customerIdStr));
                Customer customer = checkCustomerId(customerId, operation);
                return new Target(customer.getTenantId(), customerId, customerKey(customerId),
                        "customer:" + customer.getTenantId().getId() + ":" + customerId.getId());
            }
            default:
                throw new ThingsboardException("Unknown branding level: " + level, ThingsboardErrorCode.BAD_REQUEST_PARAMS);
        }
    }

    private static String customerKey(CustomerId customerId) {
        return CUSTOMER_BRANDING_KEY_PREFIX + customerId.getId();
    }

    private static ThingsboardException forbidden() {
        return new ThingsboardException("You don't have permission to perform this operation!", ThingsboardErrorCode.PERMISSION_DENIED);
    }

    private ObjectNode loadSystemBranding() {
        return loadBranding(TenantId.SYS_TENANT_ID, BRANDING_KEY);
    }

    private ObjectNode loadBranding(TenantId tenantId, String key) {
        AdminSettings settings = adminSettingsService.findAdminSettingsByTenantIdAndKey(tenantId, key);
        if (settings != null && settings.getJsonValue() instanceof ObjectNode node) {
            return node.deepCopy();
        }
        return JacksonUtil.newObjectNode();
    }

    // Values set at a lower level replace the inherited ones; empty texts keep the inherited value.
    private static void merge(ObjectNode target, ObjectNode source) {
        for (Map.Entry<String, JsonNode> field : source.properties()) {
            JsonNode value = field.getValue();
            if (value == null || value.isNull() || (value.isTextual() && value.asText().isEmpty())) {
                continue;
            }
            target.set(field.getKey(), value);
        }
    }

    private static ObjectNode validate(JsonNode body, boolean domainsAllowed) throws ThingsboardException {
        if (body == null || !body.isObject()) {
            throw badRequest("Branding must be a JSON object");
        }
        ObjectNode result = JacksonUtil.newObjectNode();
        for (Map.Entry<String, JsonNode> field : body.properties()) {
            String name = field.getKey();
            JsonNode value = field.getValue();
            if (value == null || value.isNull()) {
                continue;
            }
            if (TEXT_FIELDS.contains(name) || IMAGE_FIELDS.contains(name) || COLOR_FIELDS.contains(name)) {
                if (!value.isTextual()) {
                    throw badRequest(name + " must be a string");
                }
                String text = value.asText().trim();
                if (text.isEmpty()) {
                    continue;
                }
                if (TEXT_FIELDS.contains(name) && text.length() > MAX_TEXT_LENGTH) {
                    throw badRequest(name + " is too long");
                }
                if (IMAGE_FIELDS.contains(name) && (text.length() > MAX_IMAGE_LENGTH || !IMAGE_PATTERN.matcher(text).matches())) {
                    throw badRequest(name + " must be an image (PNG, JPEG, GIF, WebP, SVG or ICO up to 1.5 MB) or an http(s) link");
                }
                if (COLOR_FIELDS.contains(name) && !COLOR_PATTERN.matcher(text).matches()) {
                    throw badRequest(name + " must be a color like #1B1961");
                }
                result.put(name, text);
            } else if (FLAG_FIELDS.contains(name)) {
                if (!value.isBoolean()) {
                    throw badRequest(name + " must be true or false");
                }
                result.put(name, value.asBoolean());
            } else if (DOMAINS_FIELD.equals(name)) {
                if (!domainsAllowed) {
                    throw badRequest("Domains can be set for tenants and customers only");
                }
                if (!value.isArray() || value.size() > MAX_DOMAINS) {
                    throw badRequest("domains must be a list of up to " + MAX_DOMAINS + " domain names");
                }
                ArrayNode domains = result.putArray(DOMAINS_FIELD);
                for (JsonNode item : value) {
                    String domain = item.isTextual() ? normalizeDomain(item.asText()) : null;
                    if (domain == null) {
                        throw badRequest("Invalid domain name: " + item.asText());
                    }
                    boolean duplicate = false;
                    for (JsonNode existing : domains) {
                        duplicate |= existing.asText().equals(domain);
                    }
                    if (!duplicate) {
                        domains.add(domain);
                    }
                }
            } else {
                throw badRequest("Unknown branding field: " + name);
            }
        }
        return result;
    }

    private static ThingsboardException badRequest(String message) {
        return new ThingsboardException(message, ThingsboardErrorCode.BAD_REQUEST_PARAMS);
    }

    private static String normalizeDomain(String domain) {
        if (domain == null) {
            return null;
        }
        String result = domain.trim().toLowerCase(Locale.ROOT);
        if (result.endsWith(".")) {
            result = result.substring(0, result.length() - 1);
        }
        return DOMAIN_PATTERN.matcher(result).matches() ? result : null;
    }

    private String findDomainOwner(String domain) {
        AdminSettings index = adminSettingsService.findAdminSettingsByKey(TenantId.SYS_TENANT_ID, DOMAINS_KEY);
        if (index == null || index.getJsonValue() == null) {
            return null;
        }
        JsonNode owner = index.getJsonValue().get(domain);
        return owner != null && owner.isTextual() ? owner.asText() : null;
    }

    // Domain -> owner index used by the login page. A domain can belong to one brand only.
    private void updateDomainIndex(String owner, ArrayNode domains) throws ThingsboardException {
        if (owner == null) {
            return;
        }
        AdminSettings index = adminSettingsService.findAdminSettingsByKey(TenantId.SYS_TENANT_ID, DOMAINS_KEY);
        ObjectNode map = index != null && index.getJsonValue() instanceof ObjectNode node ? node.deepCopy() : JacksonUtil.newObjectNode();
        if (domains != null) {
            for (JsonNode domain : domains) {
                JsonNode current = map.get(domain.asText());
                if (current != null && !owner.equals(current.asText())) {
                    throw badRequest("The domain " + domain.asText() + " is already used by another brand");
                }
            }
        }
        List<String> previous = new ArrayList<>();
        for (Map.Entry<String, JsonNode> entry : map.properties()) {
            if (owner.equals(entry.getValue().asText())) {
                previous.add(entry.getKey());
            }
        }
        map.remove(previous);
        if (domains != null) {
            for (JsonNode domain : domains) {
                map.put(domain.asText(), owner);
            }
        }
        if (index == null) {
            index = new AdminSettings();
            index.setTenantId(TenantId.SYS_TENANT_ID);
            index.setKey(DOMAINS_KEY);
        }
        index.setJsonValue(map);
        adminSettingsService.saveAdminSettings(TenantId.SYS_TENANT_ID, index);
    }
}
