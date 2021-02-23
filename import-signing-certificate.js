// MIT License - Copyright (c) 2020 Stefan Arentz <stefan@devbots.xyz>
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.


const fs = require("fs");
const path = require('path');

const core = require('@actions/core');
const execa = require('execa');


const main = async () => {
    try {
        const keychainName = core.getInput("keychain-name") || `devbotsxyz-xcode-certificates-${process.env.GITHUB_REPOSITORY}`;
        const keychainPassword = core.getInput("keychain-password", {required: true});
        const keychainPath = path.join(process.env.HOME, "Library/Keychains", keychainName + "-db");

        // Setup the keychain if it does not exist yet

        if (!fs.existsSync(keychainPath)) {
            const setupCommands = [
                ['security', ['create-keychain', '-p', keychainPassword, keychainName]],
            ];

            for (const command of setupCommands) {
                await execa(command[0], command[1]);
            }
        }

        // Import the certificate

        let certificatePath = core.getInput('certificate-path');
        if (certificatePath === "") {
            const certificateData = core.getInput('certificate-data', {required: true});
            const buffer = Buffer.from(certificateData, 'base64');
            certificatePath = "/tmp/certificate.p12";
            fs.writeFileSync(certificatePath, buffer);
        }

        const certificatePassphrase = core.getInput('certificate-passphrase', {required: true});

        const importCommands = [
            ['security', ['default-keychain', '-s', keychainName]],
            ['security', ['unlock-keychain', '-p', keychainPassword, keychainName]],
            ['security', ['import', certificatePath, '-f', 'pkcs12', '-k', keychainName, '-P', certificatePassphrase, '-T', '/usr/bin/codesign', '-x' ]],
            ['security', ['set-key-partition-list', '-S', 'apple-tool:,apple:', '-s', '-k', keychainPassword, keychainName]]
        ]

        for (const command of importCommands) {
            await execa(command[0], command[1]);
        }

        core.setOutput("keychain-name", keychainName);
    } catch (error) {
        core.setFailed(error.message);
        throw error;
    } finally {
        if (fs.existsSync("/tmp/certificate.p12")) {
            fs.unlinkSync("/tmp/certificate.p12");
        }
    }
};


main();
