package com.cartera.service.auth;

import com.cartera.exception.ApiException;
import com.cartera.model.User;
import com.cartera.repository.UserRepository;
import org.junit.jupiter.api.Test;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.security.crypto.password.NoOpPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** El bloqueo por correo solo salta con un ataque repartido entre muchas IP, no con unos pocos fallos ajenos. */
class PasswordAuthServiceTest {

    private final UserRepository users = mock(UserRepository.class);
    private final PasswordAuthService service = new PasswordAuthService(users, passwordEncoder(),
            mock(ApplicationEventPublisher.class), true);

    @SuppressWarnings("deprecation")
    private static PasswordEncoder passwordEncoder() {
        return NoOpPasswordEncoder.getInstance();
    }

    private User ana() {
        // Sin prefijo {..}: el codificador de prueba compara el texto tal cual.
        User ana = User.builder().id(UUID.randomUUID()).email("ana@test.invalid").passwordHash("correcta-correcta").build();
        when(users.findByEmail("ana@test.invalid")).thenReturn(Optional.of(ana));
        return ana;
    }

    @Test
    void fewFailuresFromOtherIpsDoNotBlockTheOwner() {
        ana();
        for (int i = 0; i < 50; i++) {
            int n = i;
            assertThatThrownBy(() -> service.login("ana@test.invalid", "mal", "9.9.9." + n))
                    .isInstanceOf(ApiException.class).hasMessageContaining("incorrectos");
        }
        assertThat(service.login("ana@test.invalid", "correcta-correcta", "1.1.1.1").getEmail()).isEqualTo("ana@test.invalid");
    }

    @Test
    void anAttackSpreadOverManyIpsEndsUpBlockingTheEmail() {
        ana();
        for (int i = 0; i < PasswordAuthService.MAX_FAILURES_PER_EMAIL; i++) {
            int n = i;
            assertThatThrownBy(() -> service.login("ana@test.invalid", "mal", "9.9.9." + n))
                    .isInstanceOf(ApiException.class);
        }
        assertThatThrownBy(() -> service.login("ana@test.invalid", "correcta-correcta", "1.1.1.1"))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.getStatus().value()).isEqualTo(429));
    }

    @Test
    void theSameIpIsBlockedAfterTenFailuresEvenWithTheRightPassword() {
        ana();
        for (int i = 0; i < PasswordAuthService.MAX_FAILURES_PER_EMAIL_AND_IP; i++) {
            assertThatThrownBy(() -> service.login("ana@test.invalid", "mal", "2.2.2.2")).isInstanceOf(ApiException.class);
        }
        assertThatThrownBy(() -> service.login("ana@test.invalid", "correcta-correcta", "2.2.2.2"))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.getStatus().value()).isEqualTo(429));
    }

    @Test
    void newPasswordsNeedTwelveCharactersAndFitBcrypt() {
        assertThatThrownBy(() -> PasswordAuthService.validateNew("corta")).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> PasswordAuthService.validateNew("ñ".repeat(40))).isInstanceOf(ApiException.class);
        PasswordAuthService.validateNew("una-contraseña-larga");
    }
}
