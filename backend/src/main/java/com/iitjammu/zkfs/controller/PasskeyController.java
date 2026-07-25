package com.iitjammu.zkfs.controller;

import com.iitjammu.zkfs.service.PasskeyService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/v1/auth/passkey")
@RequiredArgsConstructor
public class PasskeyController {

    private final PasskeyService passkeyService;

    // ── Registration (Requires active session via Password) ───────────────────

    @GetMapping("/register/options")
    public ResponseEntity<String> registerOptions(@AuthenticationPrincipal UserDetails userDetails) throws Exception {
        return ResponseEntity.ok(passkeyService.generateRegistrationOptions(userDetails.getUsername()));
    }

    @PostMapping("/register")
    public ResponseEntity<Map<String, String>> register(
            @AuthenticationPrincipal UserDetails userDetails,
            @RequestBody RegisterRequest request) throws Exception {
        passkeyService.finishRegistration(userDetails.getUsername(), request.responseJson(), request.passkeyWrappedKek(), request.deviceName());
        return ResponseEntity.ok(Map.of("status", "success"));
    }

    // ── Login (Public) ────────────────────────────────────────────────────────

    @GetMapping("/login/options")
    public ResponseEntity<Map<String, Object>> loginOptions(@RequestParam(required = false) String email) throws Exception {
        return ResponseEntity.ok(passkeyService.generateLoginOptions(email));
    }

    @PostMapping("/login")
    public ResponseEntity<Map<String, Object>> login(@RequestBody LoginRequest request) throws Exception {
        PasskeyService.LoginResult result = passkeyService.finishLogin(request.requestId(), request.responseJson());
        return ResponseEntity.ok(Map.of(
                "token", result.token(),
                "refreshToken", result.refreshToken(),
                "passkeyWrappedKek", result.passkeyWrappedKek(),
                "user", Map.of(
                        "id", result.user().getId(),
                        "email", result.user().getEmail()
                )
        ));
    }

    // ── Management (Requires active session) ──────────────────────────────────

    @GetMapping("/list")
    public ResponseEntity<java.util.List<PasskeyDto>> listPasskeys(@AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(passkeyService.getUserPasskeys(userDetails.getUsername()));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Map<String, String>> deletePasskey(
            @AuthenticationPrincipal UserDetails userDetails,
            @PathVariable java.util.UUID id) {
        passkeyService.deletePasskey(userDetails.getUsername(), id);
        return ResponseEntity.ok(Map.of("status", "success"));
    }

    public record RegisterRequest(String responseJson, String passkeyWrappedKek, String deviceName) {}
    public record LoginRequest(String requestId, String responseJson) {}
    public record PasskeyDto(java.util.UUID id, String name, java.time.OffsetDateTime createdAt) {}
}
