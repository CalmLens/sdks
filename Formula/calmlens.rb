class Calmlens < Formula
  desc "CalmLens CLI for local webhook development"
  homepage "https://calmlens.com"
  version "0.28.1"

  on_macos do
    on_arm do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.28.1/calmlens-0.28.1-darwin-arm64.tar.gz"
      sha256 "c7b77f8e618625d461c8d6ae44cbc543d62a77f34038f10f6110d3946e2ed627"
    end
    on_intel do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.28.1/calmlens-0.28.1-darwin-x64.tar.gz"
      sha256 "265608ffb94d0003176ae46a174570a0e9aa51d17e867b36bc3eb2a34bf40497"
    end
  end
  on_linux do
    on_arm do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.28.1/calmlens-0.28.1-linux-arm64.tar.gz"
      sha256 "61fff5c5145c782cd347273a7b08c0e9cd56e3e0a29b35c128068d23f651c184"
    end
    on_intel do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.28.1/calmlens-0.28.1-linux-x64.tar.gz"
      sha256 "b3850cde23559b10cc4cdaa8134acbfd0402a0d9cec466cad9e8e72f0de32c7e"
    end
  end

  def install
    bin.install "calmlens"
  end

  test do
    assert_equal version.to_s, shell_output("#{bin}/calmlens --version").strip
  end
end
