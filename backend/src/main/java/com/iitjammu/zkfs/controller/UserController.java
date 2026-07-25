package com.iitjammu.zkfs.controller;

import com.iitjammu.zkfs.domain.User;
import com.iitjammu.zkfs.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import java.util.Map;

@Validated
@RestController
@RequestMapping("/v1/users")
@RequiredArgsConstructor
public class UserController {

    private final UserRepository userRepository;

    @GetMapping("/public-key")
    public ResponseEntity<Map<String, String>> getPublicKey(
            @RequestParam
            @NotBlank(message = "Email parameter is required")
            @Email(message = "Email must be a valid address")
            String email
    ) {
        User user = userRepository.findByEmail(email)
                .orElse(null);

        if (user == null || user.getPublicKey() == null) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
        }

        return ResponseEntity.ok(Map.of("publicKey", user.getPublicKey(), "id", user.getId().toString()));
    }
}
