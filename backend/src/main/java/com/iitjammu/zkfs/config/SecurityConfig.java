package com.iitjammu.zkfs.config;

import com.iitjammu.zkfs.security.JwtAccessDeniedHandler;
import com.iitjammu.zkfs.security.JwtAuthenticationEntryPoint;
import com.iitjammu.zkfs.security.JwtAuthenticationFilter;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.AuthenticationProvider;
import org.springframework.security.authentication.dao.DaoAuthenticationProvider;
import org.springframework.security.config.annotation.authentication.configuration.AuthenticationConfiguration;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;

/**
 * Spring Security Configuration — Phase 2 (Complete)
 * ════════════════════════════════════════════════════
 *
 * <h3>Security model:</h3>
 * <ul>
 *   <li><strong>Stateless JWT</strong> — no HTTP session, no cookies for auth.</li>
 *   <li><strong>CSRF disabled</strong> — not applicable for stateless REST + Bearer tokens.</li>
 *   <li><strong>CORS</strong> — delegated to {@link CorsConfig#corsConfigurationSource()}.</li>
 *   <li><strong>BCrypt(12)</strong> — used to hash the client-derived authHash.</li>
 *   <li><strong>JSON 401/403</strong> — via custom entry point and access denied handler.</li>
 * </ul>
 *
 * <h3>Route authorization:</h3>
 * <pre>
 *   PUBLIC  (no token required):
 *     POST   /v1/auth/register
 *     POST   /v1/auth/login
 *     POST   /v1/auth/refresh
 *     GET    /v1/auth/salt
 *     GET    /actuator/health
 *     OPTIONS /** (CORS preflight)
 *
 *   PROTECTED (valid JWT Bearer token required):
 *     GET    /v1/auth/me
 *     GET    /v1/files/**
 *     POST   /v1/files/**
 *     PUT    /v1/files/**
 *     PATCH  /v1/files/**
 *     DELETE /v1/files/**
 * </pre>
 */
@Configuration
@EnableWebSecurity
@EnableMethodSecurity(prePostEnabled = true)
@RequiredArgsConstructor
public class SecurityConfig {

    private final JwtAuthenticationFilter       jwtAuthFilter;
    private final JwtAuthenticationEntryPoint   authEntryPoint;
    private final JwtAccessDeniedHandler        accessDeniedHandler;
    private final UserDetailsService            userDetailsService;
    private final CorsConfig                    corsConfig;

    // ── Security Filter Chain ─────────────────────────────────────────────────

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http
            // ── Disable CSRF (stateless REST + JWT, no session cookies) ──────
            .csrf(AbstractHttpConfigurer::disable)

            // ── CORS — delegate to CorsConfig bean ────────────────────────────
            .cors(cors -> cors.configurationSource(corsConfig.corsConfigurationSource()))

            // ── Stateless sessions ────────────────────────────────────────────
            .sessionManagement(session ->
                session.sessionCreationPolicy(SessionCreationPolicy.STATELESS)
            )

            // ── Custom JSON error responses ────────────────────────────────────
            .exceptionHandling(ex -> ex
                .authenticationEntryPoint(authEntryPoint)     // 401 → JSON
                .accessDeniedHandler(accessDeniedHandler)      // 403 → JSON
            )

            // ── Route authorization ───────────────────────────────────────────
            .authorizeHttpRequests(auth -> auth

                // ── Public: auth endpoints ──────────────────────────────────
                .requestMatchers(
                    HttpMethod.POST,
                    "/v1/auth/register",
                    "/v1/auth/login",
                    "/v1/auth/refresh",
                    "/v1/auth/passkey/login"
                ).permitAll()
                .requestMatchers(
                    HttpMethod.GET,
                    "/v1/auth/salt",
                    "/v1/auth/passkey/login/options"
                ).permitAll()

                // ── Public: actuator health only ────────────────────────────
                .requestMatchers("/actuator/health").permitAll()

                // ── Public: CORS preflight ──────────────────────────────────
                .requestMatchers(HttpMethod.OPTIONS, "/**").permitAll()

                // ── Public: share token endpoints (no JWT — token IS the auth) ──
                .requestMatchers(HttpMethod.GET, "/v1/share/*/chunk/*/stream").permitAll()
                .requestMatchers(HttpMethod.GET, "/v1/share/*").permitAll()

                // ── Protected: authenticated user profile ───────────────────
                .requestMatchers(HttpMethod.GET, "/v1/auth/me").authenticated()

                // ── Protected: all file + share write operations need JWT ───
                .requestMatchers("/v1/files/**").authenticated()
                .requestMatchers(HttpMethod.POST,   "/v1/share").authenticated()
                .requestMatchers(HttpMethod.DELETE, "/v1/share/**").authenticated()
                .requestMatchers(HttpMethod.GET,    "/v1/share").authenticated()

                // ── Default: everything else also requires authentication ────
                .anyRequest().authenticated()
            )

            // ── Wire authentication provider and JWT filter ───────────────────
            .authenticationProvider(authenticationProvider())
            .addFilterBefore(jwtAuthFilter, UsernamePasswordAuthenticationFilter.class);

        return http.build();
    }

    // ── Authentication Provider ───────────────────────────────────────────────

    @Bean
    public AuthenticationProvider authenticationProvider() {
        DaoAuthenticationProvider provider = new DaoAuthenticationProvider();
        provider.setUserDetailsService(userDetailsService);
        provider.setPasswordEncoder(passwordEncoder());
        return provider;
    }

    @Bean
    public AuthenticationManager authenticationManager(AuthenticationConfiguration config)
            throws Exception {
        return config.getAuthenticationManager();
    }

    // ── Password Encoder ──────────────────────────────────────────────────────

    /**
     * BCrypt with cost factor 12 (~250-350ms per hash on modern hardware).
     * Applied to the client-derived authHash (not the raw password).
     * Provides a second line of defense if the auth hash is somehow leaked.
     */
    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder(12);
    }
}
