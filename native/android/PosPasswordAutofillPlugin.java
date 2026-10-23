package com.luckycharms.pos;

import androidx.core.content.ContextCompat;
import androidx.credentials.CreateCredentialResponse;
import androidx.credentials.CreatePasswordRequest;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.GetPasswordOption;
import androidx.credentials.PasswordCredential;
import androidx.credentials.exceptions.CreateCredentialException;
import androidx.credentials.exceptions.GetCredentialException;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Collections;

/** Only the Android password provider stores credentials; POS never persists them. */
@CapacitorPlugin(name = "PosPasswordAutofill")
public class PosPasswordAutofillPlugin extends Plugin {
    @PluginMethod
    public void savePassword(PluginCall call) {
        String username = call.getString("username", "").trim();
        String password = call.getString("password", "");
        if (username.isEmpty() || password.isEmpty()) {
            call.reject("A verified username and password are required.");
            return;
        }
        getActivity().runOnUiThread(() -> {
            try {
                CredentialManager.create(getActivity()).createCredentialAsync(
                    getActivity(), new CreatePasswordRequest(username, password, null, false, false),
                    null, ContextCompat.getMainExecutor(getContext()),
                    new CredentialManagerCallback<CreateCredentialResponse, CreateCredentialException>() {
                        @Override public void onResult(CreateCredentialResponse result) { call.resolve(); }
                        @Override public void onError(CreateCredentialException error) {
                            call.reject("The password manager did not save this login.");
                        }
                    });
            } catch (RuntimeException error) {
                call.reject("The password manager is unavailable.");
            }
        });
    }

    @PluginMethod
    public void requestPassword(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                GetCredentialRequest request = new GetCredentialRequest.Builder()
                    .addCredentialOption(new GetPasswordOption(Collections.emptySet(), false, Collections.emptySet()))
                    .build();
                CredentialManager.create(getActivity()).getCredentialAsync(
                    getActivity(), request, null, ContextCompat.getMainExecutor(getContext()),
                    new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                        @Override public void onResult(GetCredentialResponse result) {
                            if (!(result.getCredential() instanceof PasswordCredential)) {
                                call.reject("No password was selected.");
                                return;
                            }
                            PasswordCredential credential = (PasswordCredential) result.getCredential();
                            JSObject response = new JSObject();
                            response.put("username", credential.getId());
                            response.put("password", credential.getPassword());
                            call.resolve(response);
                        }
                        @Override public void onError(GetCredentialException error) {
                            call.reject("No saved login was selected.");
                        }
                    });
            } catch (RuntimeException error) {
                call.reject("The password manager is unavailable.");
            }
        });
    }
}
