using System;
using System.IO;
using System.Reflection;
using System.Diagnostics;
using System.IO.Compression;
using System.Threading;
using System.Windows.Forms;
using System.Drawing;

class ExtractSplash : Form {
    public ExtractSplash() {
        this.Text = "Apify Studio Setup";
        this.Size = new Size(420, 160);
        this.FormBorderStyle = FormBorderStyle.FixedDialog;
        this.StartPosition = FormStartPosition.CenterScreen;
        this.MaximizeBox = false;
        this.MinimizeBox = false;
        this.ControlBox = false;
        this.BackColor = Color.FromArgb(20, 20, 20);
        this.ShowInTaskbar = true;

        Label lblTitle = new Label() {
            Text = "APIFY STUDIO",
            ForeColor = Color.FromArgb(16, 185, 129), // emerald-500 color
            Font = new Font("Segoe UI", 12, FontStyle.Bold),
            Location = new Point(24, 24),
            AutoSize = true
        };

        Label lblMessage = new Label() {
            Text = "Setting up local sandbox environment...\nThis first-time initialization takes a few seconds.",
            ForeColor = Color.FromArgb(200, 200, 200),
            Font = new Font("Segoe UI", 9, FontStyle.Regular),
            Location = new Point(24, 58),
            Size = new Size(370, 45)
        };

        this.Controls.Add(lblTitle);
        this.Controls.Add(lblMessage);
        
        // Custom dark border paint
        this.Paint += (s, e) => {
            using (Pen p = new Pen(Color.FromArgb(38, 38, 38), 1)) {
                e.Graphics.DrawRectangle(p, 0, 0, this.Width - 1, this.Height - 1);
            }
        };
    }
}

class Launcher {
    [STAThread]
    static void Main(string[] args) {
        string appName = "Apify-App";
        string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        string targetDir = Path.Combine(localAppData, appName);
        string exePath = Path.Combine(targetDir, "Apify.exe");
        string errorLogPath = Path.Combine(localAppData, "Apify-App-error.txt");

        // Mutex SINGLE INSTANCE Check: prevents race conditions and file-locking during duplicate execution
        bool createdNew;
        using (Mutex mutex = new Mutex(true, "ApifyMutex-SingleInstance-Setup-Akib", out createdNew)) {
            if (!createdNew) {
                // If another launcher is running (already extracting or launching), exit quietly
                return;
            }

            try {
                bool needExtraction = !File.Exists(exePath);
                string versionMarker = Path.Combine(targetDir, "version.txt");
                string currentVersion = GetBuildMarker();

                if (File.Exists(exePath) && File.Exists(versionMarker)) {
                    try {
                        string existingVersion = File.ReadAllText(versionMarker).Trim();
                        if (existingVersion != currentVersion) {
                            needExtraction = true;
                        }
                    } catch {
                        needExtraction = true;
                    }
                } else {
                    needExtraction = true;
                }

                if (needExtraction) {
                    // Show premium dark setup splash popup on extraction phase
                    ExtractSplash splash = new ExtractSplash();
                    splash.Show();
                    Application.DoEvents();

                    // Delete old directory to avoid file locking or DLL mismatch issues on updates
                    if (Directory.Exists(targetDir)) {
                        try {
                            Directory.Delete(targetDir, true);
                        } catch (Exception ex) {
                            File.AppendAllText(errorLogPath, "Directory delete exception: " + ex.Message + "\n");
                        }
                    }

                    Directory.CreateDirectory(targetDir);

                    // Extract app.zip from embedded resources
                    Assembly assembly = Assembly.GetExecutingAssembly();
                    string zipPath = Path.Combine(targetDir, "app.zip");

                    string resourceName = null;
                    foreach (string name in assembly.GetManifestResourceNames()) {
                        if (name.EndsWith("app.zip")) {
                            resourceName = name;
                            break;
                        }
                    }

                    if (resourceName != null) {
                        using (Stream resourceStream = assembly.GetManifestResourceStream(resourceName)) {
                            using (FileStream fileStream = new FileStream(zipPath, FileMode.Create)) {
                                resourceStream.CopyTo(fileStream);
                            }
                        }
                    } else {
                        File.AppendAllText(errorLogPath, "Embedded resource app.zip not found!\n");
                        splash.Close();
                        return;
                    }

                    // Extract using built-in System.IO.Compression.ZipFile
                    try {
                        ZipFile.ExtractToDirectory(zipPath, targetDir);
                    } catch (Exception ex) {
                        File.AppendAllText(errorLogPath, "ZipFile extraction exception: " + ex.ToString() + "\n");
                        splash.Close();
                        return;
                    }

                    // Clean up temporary zip
                    try {
                        File.Delete(zipPath);
                    } catch {}

                    // Write version signature
                    try {
                        File.WriteAllText(versionMarker, currentVersion);
                    } catch {}

                    // Unpacking finished, close splash popup
                    splash.Close();
                    splash.Dispose();
                }

                // Launch the unpacked Apify application
                if (File.Exists(exePath)) {
                    string arguments = "";
                    if (args != null && args.Length > 0) {
                        // Quote and escape parameters safely to prevent splitting spaces/special characters
                        for (int i = 0; i < args.Length; i++) {
                            string arg = args[i];
                            if (arg.Contains(" ") || arg.Contains("\"")) {
                                arg = "\"" + arg.Replace("\"", "\\\"") + "\"";
                            }
                            arguments += (i > 0 ? " " : "") + arg;
                        }
                    }

                    ProcessStartInfo psi = new ProcessStartInfo(exePath, arguments) {
                        UseShellExecute = true,
                        WorkingDirectory = targetDir
                    };
                    Process.Start(psi);
                } else {
                    File.AppendAllText(errorLogPath, "Unpacked Apify.exe not found at path: " + exePath + "\n");
                }
            } catch (Exception ex) {
                File.AppendAllText(errorLogPath, "Global exception: " + ex.ToString() + "\n");
            }
        }
    }

    static string GetBuildMarker() {
        try {
            string currentExe = Assembly.GetExecutingAssembly().Location;
            return File.GetLastWriteTime(currentExe).Ticks.ToString();
        } catch {
            return DateTime.UtcNow.Ticks.ToString();
        }
    }
}
